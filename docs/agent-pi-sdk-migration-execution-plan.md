# Agent Pi SDK 迁移执行文档

## 1. 文档定位

本文档是 `/agent` 从当前自研 MiniMax planner 迁移到 pi agent sdk runtime 的执行说明。目标不是简单替换模型调用，而是为后续长期能力打基础：

1. 稳定的 tool use loop。
2. 流式 thinking / text / tool / compact timeline。
3. 服务端消息持久化。
4. context compact 与 context 管理。
5. 用户习惯 memory。
6. agent 主动提醒能力预留。
7. 未来视图切换、页面导航、上下文聚焦能力预留。

本文档面向分 PR 实施。每个阶段都必须可 lint、可 build，并保留现有 `/agent` 的回退路径，直到新 runtime 通过完整 smoke。

---

## 2. 当前基线

当前 `/agent` 已经具备以下基础：

1. `/agent` 独立页面。
2. `AgentRun` 记录运行上下文。
3. `AgentActionLog` 记录 action 审计。
4. `AgentProposal` 支持 `proposal -> confirm/reject -> execute`。
5. `src/lib/agent-actions/actions/*` 中已有业务 action registry。
6. `/api/agent/tools/execute` 是正式业务工具执行入口。
7. `/api/agent/chat` 当前用 MiniMax 进行一次规划、最多执行 3 个 tool、再总结。

当前最大问题：

1. tool use 不是真正 loop，无法可靠做多跳查询、失败恢复、连续 search。
2. 消息只在前端 localStorage 缓存，不适合 compact、恢复和跨设备。
3. 没有 timeline 作为统一 UI / runtime 事件模型。
4. context 与 memory 没有服务端边界。
5. agent 无法安全承载主动提醒和未来视图控制。

---

## 3. 目标架构

### 3.1 总体形态

```text
/agent frontend
  -> Next.js /api/agent/chat-stream
    -> getServerSession(authOptions)
    -> AgentChatSession / AgentRun
    -> memory/context assembly
    -> agent-runtime sidecar /chat-stream
      -> pi agent sdk loop
      -> tool call
        -> Next.js /api/agent/tools/execute
          -> AgentRun 反查 ActorContext
          -> action registry
          -> 业务权限与审计
      -> streamed events
    -> persist AgentChatMessage timeline
    -> stream to frontend
```

### 3.2 职责边界

Next.js 负责：

1. NextAuth session 与用户身份。
2. `AgentRun` / `AgentChatSession` / `AgentChatMessage` 持久化。
3. 读取和写入 memory。
4. 主动提醒入队、确认、通知。
5. 业务 action 权限、proposal、审计。
6. 视图切换指令的权限和白名单校验。

Sidecar 负责：

1. pi agent sdk tool loop。
2. thinking/text/tool/compact event streaming。
3. compact 调用与 compact 摘要生成。
4. 按 Next.js 注入的上下文和 memory 进行推理。
5. web search / web extract 工具。
6. 产生 memory suggestion、view intent、reminder suggestion。

Sidecar 不负责：

1. 直接读写 Prisma 数据库。
2. 直接信任前端传来的 `userId` / `role`。
3. 绕过 `/api/agent/tools/execute` 调用业务逻辑。
4. 直接确认高风险写操作。
5. 直接切换浏览器视图；只能输出受控 intent。

### 3.3 环境开关

新增：

```env
AGENT_RUNTIME=legacy|pi
AGENT_RUNTIME_URL=http://127.0.0.1:31110
AGENT_RUNTIME_TOKEN=...
AGENT_COMPACTION_ENABLED=true
AGENT_CONTEXT_WINDOW_TOKENS=1000000
AGENT_COMPACTION_KEEP_RECENT_TOKENS=12000
AGENT_COMPACTION_RESERVE_TOKENS=8000
AGENT_MEMORY_ENABLED=true
AGENT_PROACTIVE_ENABLED=false
AGENT_VIEW_CONTROL_ENABLED=false
AGENT_WEB_SEARCH_ENABLED=true
```

默认开发可设为 `legacy`，demo 灰度后切 `pi`。

---

## 4. 数据模型

### 4.1 新增模型

建议新增以下 Prisma 模型。字段命名按当前项目风格保持字符串枚举，避免先引入 Prisma enum 造成迁移面扩大。

```prisma
model AgentChatSession {
  id             String   @id @default(cuid())
  userId         String
  agentRunId     String?
  title          String?
  status         String   @default("ACTIVE") // ACTIVE | ARCHIVED | DELETED
  source         String   @default("CHAT")   // CHAT | PROACTIVE | SYSTEM
  summary        String?
  compactSummary String?
  metadataJson   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  lastMessageAt  DateTime @default(now())

  @@index([userId, lastMessageAt])
  @@index([agentRunId])
  @@index([status, lastMessageAt])
}

model AgentChatMessage {
  id             String   @id @default(cuid())
  sessionId      String
  agentRunId     String?
  userId         String
  role           String   // user | assistant | system
  content        String
  state          String   @default("done") // thinking | streaming | done | error
  timelineJson   String?
  tokenUsageJson String?
  metadataJson   String?
  createdAt      DateTime @default(now())

  @@index([sessionId, createdAt])
  @@index([userId, createdAt])
  @@index([agentRunId, createdAt])
}

model AgentMemory {
  id              String   @id @default(cuid())
  userId          String
  scope           String   @default("USER") // USER | ROLE | ORG
  kind            String   // preference | working_context | instruction | correction
  content         String
  confidence      Float    @default(0.5)
  source          String   @default("AGENT") // USER_EXPLICIT | AGENT | ADMIN
  sourceMessageId String?
  status          String   @default("ACTIVE") // ACTIVE | MUTED | EXPIRED | DELETED
  metadataJson    String?
  expiresAt       DateTime?
  lastUsedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId, kind, status])
  @@index([expiresAt])
  @@index([lastUsedAt])
}

model AgentProactiveTask {
  id             String   @id @default(cuid())
  userId         String
  agentRunId     String?
  sessionId      String?
  kind           String   // reminder | daily_digest | anomaly_watch | followup_prompt
  title          String
  payloadJson    String
  status         String   @default("PENDING") // PENDING | SCHEDULED | SENT | CANCELLED | FAILED
  triggerAt      DateTime
  notificationId String?
  error          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  decidedAt      DateTime?

  @@index([userId, status, triggerAt])
  @@index([agentRunId])
  @@index([sessionId])
}
```

### 4.2 关系策略

第一阶段不强制给 `User` 添加反向 relation，减少 schema churn。若后续需要 Prisma include，再补 relation。

`AgentRun` 保留，定位为“运行上下文与审计归属”。`AgentChatSession` 才是聊天会话实体。

### 4.3 JSON 字段约定

`timelineJson` 存储数组：

```ts
type AgentTimelineItem =
  | { id: string; kind: "text"; content: string; status?: string; startedAt?: number; endedAt?: number }
  | { id: string; kind: "thinking"; content?: string; status: "running" | "done" | "error"; startedAt?: number; endedAt?: number }
  | { id: string; kind: "tool"; toolName: string; label: string; content?: string; status: "running" | "done" | "error"; input?: unknown; output?: unknown; error?: string }
  | { id: string; kind: "compact"; content: string; status: "running" | "done" | "error"; tokensBefore?: number; tokensAfter?: number }
  | { id: string; kind: "memory"; content: string; status: "suggested" | "saved" | "rejected"; memoryId?: string }
  | { id: string; kind: "view"; intent: AgentViewIntent; status: "suggested" | "applied" | "rejected" }
  | { id: string; kind: "proactive"; content: string; status: "suggested" | "scheduled" | "sent" | "rejected"; taskId?: string };
```

`metadataJson` 只存 UI/runtime 辅助信息，不存权限事实。

---

## 5. Runtime API 契约

### 5.1 Next.js 对前端 API

新增：

```text
GET  /api/agent/chat-sessions
POST /api/agent/chat-sessions
GET  /api/agent/chat-sessions/[id]
PATCH /api/agent/chat-sessions/[id]

POST /api/agent/chat-stream
POST /api/agent/chat-compact

GET  /api/agent/memory
POST /api/agent/memory
PATCH /api/agent/memory/[id]

GET  /api/agent/proactive-tasks
POST /api/agent/proactive-tasks
PATCH /api/agent/proactive-tasks/[id]
POST /api/agent/proactive-tasks/check

POST /api/agent/view-intents/apply
```

保留：

```text
GET  /api/agent/actions
POST /api/agent/tools/execute
GET  /api/agent/runs
GET  /api/agent/proposals
POST /api/agent/proposals/[id]/confirm
POST /api/agent/proposals/[id]/reject
```

`/api/agent/chat` 保留 legacy 路径，`AGENT_RUNTIME=legacy` 时继续使用。

### 5.2 Next.js 到 sidecar API

Sidecar 只暴露内部端口：

```text
GET  /health
POST /chat-stream
POST /chat-compact
```

`/chat-stream` request：

```ts
interface RuntimeChatStreamRequest {
  requestId: string;
  agentRunId: string;
  sessionId: string;
  user: {
    id: string;
    role: string;
    name?: string | null;
    email?: string | null;
  };
  message: string;
  history: RuntimeHistoryMessage[];
  compactSummary?: string | null;
  memories: RuntimeMemory[];
  availableTools: RuntimeToolSpec[];
  context: {
    currentView?: AgentViewState | null;
    viewControlEnabled: boolean;
    webSearchEnabled: boolean;
    proactiveEnabled: boolean;
  };
}
```

Sidecar response is NDJSON or SSE. Event types:

```ts
type RuntimeStreamEvent =
  | { type: "message_start"; message_id: string }
  | { type: "thinking_delta"; id: string; delta: string }
  | { type: "text_delta"; id: string; delta: string }
  | { type: "tool_start"; id: string; tool_name: string; label: string; input?: unknown }
  | { type: "tool_end"; id: string; tool_name: string; output?: unknown }
  | { type: "tool_error"; id: string; tool_name: string; error: string }
  | { type: "compact_start"; id: string; tokens_before?: number }
  | { type: "compact_end"; id: string; summary: string; tokens_before?: number; tokens_after?: number }
  | { type: "memory_suggestion"; id: string; memory: RuntimeMemorySuggestion }
  | { type: "view_intent"; id: string; intent: AgentViewIntent }
  | { type: "proactive_task_suggestion"; id: string; task: RuntimeProactiveSuggestion }
  | { type: "usage"; usage: RuntimeTokenUsage }
  | { type: "message_end"; message_id: string; content: string }
  | { type: "error"; error: string };
```

### 5.3 Tool callback

Sidecar 调 tool 时调用 Next.js：

```text
POST /api/agent/tools/execute
headers:
  x-agent-runtime-token: <AGENT_RUNTIME_TOKEN>
body:
  {
    "agentRunId": "...",
    "sessionId": "...",
    "actionKey": "projects.search",
    "input": {...}
  }
```

Next.js 必须：

1. 校验 runtime token。
2. 用 `agentRunId` 反查 actor。
3. 不接受 sidecar 传入的 `userId` / `role` 作为权限事实。
4. 对 `confirm` action 只创建 proposal，不直接执行。
5. 写 `AgentActionLog`。

---

## 6. Tool 体系

### 6.1 业务工具

继续复用 `src/lib/agent-actions/actions/*`。所有业务 tool 都来自 `/api/agent/actions` 和 `actionToTool()`。

禁止：

1. 直接把页面 API 批量暴露为 tool。
2. 让 sidecar 直接 import 项目业务代码。
3. 在 sidecar 中复制权限逻辑。

### 6.2 网络搜索工具

新增 action 或 runtime tool：

1. `web.search`
2. `web.extract` 可后置实现。

项目已有 `src/lib/draft/providers/minimax-search.ts`，优先复用 MiniMax search provider。

建议第一阶段将 `web.search` 做成 Next.js action：

1. 统一审计。
2. 复用现有 MiniMax 配置。
3. 便于后续按角色关闭外网搜索。

如果 sidecar SDK 对 web search 有成熟内置工具，可以在第二阶段切到 sidecar，但仍要把 search event 写回 timeline。

### 6.3 View 工具

未来视图切换不是业务写操作，但会影响用户工作流，必须做成受控 intent。

新增工具建议：

1. `ui.suggest_view`
2. `ui.focus_entity`
3. `ui.open_panel`
4. `ui.set_filter`

第一阶段只返回 intent，不自动 apply。

`AgentViewIntent`：

```ts
interface AgentViewIntent {
  type: "navigate" | "focus_entity" | "open_panel" | "set_filter";
  route?: string;
  entityType?: "project" | "order" | "customer" | "invoice" | "ticket";
  entityId?: string;
  panel?: string;
  filters?: Record<string, string | number | boolean | null>;
  label: string;
  reason?: string;
}
```

Next.js `/api/agent/view-intents/apply` 校验：

1. route 白名单。
2. entity read permission。
3. filter 字段白名单。
4. 不允许通过 view intent 触发写操作。

前端收到 `view_intent` 后显示“打开项目 / 聚焦订单 / 切换到发票视图”按钮。用户点击后再执行。

---

## 7. Memory 策略

### 7.1 Memory 分类

允许：

1. `preference`：用户偏好的回答格式、常看指标、默认筛选。
2. `working_context`：近期关注的客户、项目、订单，可过期。
3. `instruction`：用户明确表达的长期偏好。
4. `correction`：用户纠正 agent 的事实或口径。

禁止：

1. 用 memory 存业务事实主数据。
2. 用 memory 绕过权限。
3. 记录敏感凭据、密钥、密码。
4. 把所有对话摘要无差别写入 memory。

业务事实必须来自数据库和 action tool 结果。

### 7.2 写入规则

Sidecar 只产出 `memory_suggestion`。

Next.js 决定是否落库：

1. 用户显式说“以后都”“默认”“记住”时，可自动保存为 `USER_EXPLICIT`，confidence >= 0.8。
2. agent 推断出的偏好先保存为低 confidence，或仅在 UI 中提示确认。
3. `working_context` 必须有过期时间，默认 7 到 30 天。
4. 用户可在 `/agent` 设置区删除或 mute memory。

### 7.3 注入规则

每轮 chat 前，Next.js 查询 memory：

1. `status = ACTIVE`
2. `expiresAt IS NULL OR expiresAt > now`
3. 当前用户可用
4. 按 kind / lastUsedAt / confidence 排序
5. 限制条数和字符数

注入给 sidecar 的 memory 必须是摘要形态：

```text
用户偏好：
- 默认关注订单回款和发票状态。
- 项目摘要优先按交付节点、工单、风险排序。

近期上下文：
- 最近关注客户：...
```

---

## 8. Context 与 Compact

### 8.1 Context 组装

每轮发送给 sidecar：

1. 最近 N 条 `AgentChatMessage`。
2. session `compactSummary`。
3. 用户 memory 摘要。
4. 当前 view state。
5. 可用 tool specs。

不要把完整工具 raw JSON 长期塞进 prompt。工具结果进入 timeline 和数据库，prompt 只保留必要摘要。

### 8.2 Compact 策略

支持两种 compact：

1. 手动 `/compact`。
2. 自动 compact，超过 token 阈值时由 sidecar 发起。

compact 结果：

1. 写入一个 `kind = compact` 的 timeline item。
2. 更新 `AgentChatSession.compactSummary`。
3. compact 前后的 token usage 写入 `tokenUsageJson`。

compact 不得：

1. 删除原始消息。
2. 覆盖审计日志。
3. 改写 proposal input。

---

## 9. 主动提醒预留

### 9.1 第一阶段能力

第一阶段只支持“建议式主动提醒”：

1. agent 在对话中产出 `proactive_task_suggestion`。
2. 前端展示确认按钮。
3. 用户确认后写 `AgentProactiveTask`。
4. 后台扫描到期任务，生成 `Notification`。
5. 可选地向对应 `AgentChatSession` 追加 assistant message。

### 9.2 后台触发

复用现有提醒调度思路，新增：

```text
POST /api/agent/proactive-tasks/check
```

生产环境可由 cron 调用。开发环境可手动调用。

### 9.3 风险边界

主动提醒不得默认执行写操作。比如：

1. 可以提醒“某订单可能需要跟进回款”。
2. 可以建议“是否创建 CRM 跟进任务”。
3. 不可以未经确认直接创建跟进任务。
4. 不可以未经确认直接改订单、发票、项目状态。

---

## 10. 前端改造

### 10.1 目标 UI

`/agent` 改成更接近 OpenAI 风格的中心对话：

1. 中心聊天区为主，侧栏是会话、能力、proposal。
2. assistant 消息以文本优先，不默认重卡片。
3. tool / compact / memory / view intent 作为 inline timeline。
4. 输入框固定底部，支持 `/compact`。
5. message reload 完全来自服务端 session，不依赖 localStorage 作为事实来源。

### 10.2 状态模型

新增前端 reducer / hook：

```text
src/components/agent/
  agent-workbench.tsx
  agent-chat-panel.tsx
  agent-timeline.tsx
  agent-session-sidebar.tsx
  agent-memory-panel.tsx
  agent-proactive-panel.tsx
  use-agent-stream.ts
  agent-chat-types.ts
```

`agent-workbench.tsx` 不再承担全部状态拼接。

### 10.3 View intent

前端对 `view_intent` 的处理：

1. timeline 中展示可点击 action。
2. 点击后调用 `/api/agent/view-intents/apply`。
3. 后端返回 canonical route / search params。
4. 前端 `router.push()` 或局部更新筛选。

不要让 sidecar 直接输出任意 URL 后由前端跳转。

---

## 11. Sidecar 目录与部署

### 11.1 目录

新增：

```text
agent-runtime/
  package.json
  src/
    server.ts
    config.ts
    pi-runtime.ts
    minimax-model.ts
    tool-client.ts
    compact.ts
    event-mapper.ts
    prompts.ts
```

如果 pi sdk 当前只适合 CommonJS，也可以先用 `server.js`，但配置与工具 client 仍要拆文件。

### 11.2 npm scripts

根 `package.json` 增加：

```json
{
  "scripts": {
    "agent-runtime:dev": "npm --prefix agent-runtime run dev",
    "agent-runtime:build": "npm --prefix agent-runtime run build"
  }
}
```

### 11.3 systemd

demo/prod 部署脚本后续增加：

1. 安装 `agent-runtime` 依赖。
2. 写运行时 `.env`。
3. 创建 `task-manager-agent-runtime.service`。
4. Next.js 服务启动前先检查 sidecar health。

灰度期 Next.js 不强依赖 sidecar；`AGENT_RUNTIME=legacy` 时允许 sidecar 不存在。

---

## 12. 执行顺序

### PR 1: Schema 与基础 API

目标：

1. 新增 `AgentChatSession`、`AgentChatMessage`、`AgentMemory`、`AgentProactiveTask`。
2. 新增 chat session CRUD。
3. 新增 memory CRUD。
4. 新增 proactive task 基础 CRUD。

不要做：

1. 不接 pi sdk。
2. 不改现有 `/agent` 主 UI。
3. 不切 `/api/agent/chat`。

验收：

1. `npx prisma db push`
2. `npm run lint`
3. 能创建、读取、更新 session。
4. 未登录访问返回 401。

### Review Gate A

重点检查：

1. Prisma relation 和索引。
2. JSON 字段边界。
3. session / run 的职责是否混淆。
4. memory 是否会变成业务事实存储。

### PR 2: Sidecar 骨架

目标：

1. 新增 `agent-runtime/`。
2. 接入 pi agent sdk。
3. 实现 `/health`、`/chat-stream`、`/chat-compact` 空链路。
4. 实现 runtime token 校验。
5. 实现事件格式映射。

不要做：

1. 不接真实业务 tool。
2. 不默认切换生产 runtime。

验收：

1. `npm --prefix agent-runtime run build`
2. `/health` 返回 200。
3. `/chat-stream` 能返回 text event。

### Review Gate B

重点检查：

1. sidecar 是否只暴露内部受控 API。
2. token 和 origin 限制是否清晰。
3. 事件协议是否能被前端增量消费。

### PR 3: Tool callback 与业务 action 桥接

目标：

1. sidecar 从 Next.js 拉取 available tools。
2. sidecar 调 `/api/agent/tools/execute`。
3. Next.js 增加 `x-agent-runtime-token` 校验。
4. `confirm` action 仍只生成 proposal。
5. tool start/end/error 写入 timeline。

验收：

1. `projects.search` 可通过 sidecar loop 调用。
2. `projects.search -> projects.get_summary` 可多步执行。
3. confirm 类 action 生成 proposal，不直接落业务写入。
4. `AgentActionLog` 正常写入。

### Review Gate C

重点检查：

1. sidecar 是否无法伪造用户身份。
2. 业务权限是否仍在 execute 内部校验。
3. tool error 是否能进入 timeline。

### PR 4: 持久化 Chat Stream

目标：

1. 新增 `/api/agent/chat-stream`。
2. Next.js 代理 sidecar stream。
3. 每轮创建 `AgentChatMessage`。
4. timeline 增量合并并落库。
5. session `lastMessageAt` 更新。

验收：

1. 刷新页面后消息恢复。
2. 跨浏览器登录同账号可看到会话。
3. streaming 中断后 message 标记为 error。
4. localStorage 不再是消息事实来源。

### Review Gate D

重点检查：

1. 流中断和重复提交处理。
2. timeline merge 是否幂等。
3. 大消息 JSON 是否有上限保护。

### PR 5: Compact 与 Context 管理

目标：

1. 实现 `/api/agent/chat-compact`。
2. 支持 `/compact`。
3. 自动 compact 阈值开关。
4. 更新 `AgentChatSession.compactSummary`。
5. compact timeline 可视化。

验收：

1. 手动 `/compact` 生成 compact timeline。
2. compact 后继续追问能引用压缩前上下文。
3. 原始消息不丢失。

### PR 6: Memory

目标：

1. 每轮注入用户 memory 摘要。
2. 支持 `memory_suggestion` event。
3. 支持确认保存 / mute / delete memory。
4. working context 支持过期。

验收：

1. 用户说“以后项目摘要优先列风险”，可生成 memory。
2. 后续摘要回答体现该偏好。
3. 用户删除 memory 后不再注入。

### PR 7: Web Search

目标：

1. 新增 `web.search` action 或 runtime tool。
2. 优先复用 MiniMax search provider。
3. search event 写入 timeline。
4. prompt 约束：当前信息、外部资料、官网信息才搜索。

验收：

1. “帮我查某机构官网信息”触发搜索。
2. 搜索结果带标题、URL、摘要。
3. 未配置 search 时优雅提示。

### PR 8: View Intent

目标：

1. 新增 view intent event。
2. 新增 `/api/agent/view-intents/apply`。
3. 前端支持点击跳转/聚焦/筛选。
4. route/entity/filter 白名单。

验收：

1. agent 可以建议“打开该项目详情”。
2. 用户点击后跳转到 `/projects/[id]`。
3. 无权限对象不能跳转。

### PR 9: Proactive Task

目标：

1. 支持 agent 建议提醒。
2. 用户确认后写 `AgentProactiveTask`。
3. `check` route 到期创建 Notification。
4. 可选追加 agent session message。

验收：

1. 对话中生成“明天提醒我跟进该客户”建议。
2. 确认后到期产生站内通知。
3. 未确认建议不会进入调度。

### PR 10: UI 收口与默认切换

目标：

1. `/agent` 切到 OpenAI 风格中心对话。
2. session sidebar、memory panel、proposal panel 收口。
3. `AGENT_RUNTIME=pi` 在 demo 默认启用。
4. legacy planner 保留一个版本周期。

验收：

1. demo `/agent` 可完整多轮使用。
2. `/agent` 移动端不溢出。
3. proposal、tool、compact、memory、view intent 均可展示。

---

## 13. Prompt 约束

System prompt 必须包含：

1. 你是 SciManage 的科研项目管理 agent。
2. 只能通过工具读取或修改业务数据。
3. 不得编造项目、订单、客户、发票状态。
4. 写操作必须通过 proposal，由用户确认。
5. memory 只记录偏好、纠正、工作习惯，不记录业务主数据。
6. view intent 只是建议，不能声称已经切换视图。
7. 主动提醒必须先建议或确认，不得默认执行高风险动作。
8. web search 只用于外部/current 信息，内部业务数据必须用业务工具。

---

## 14. 安全要求

必须保持：

1. 权限边界只在 Next.js 后端、NextAuth session、AgentRun、业务权限函数。
2. Sidecar 不是权限边界。
3. Sidecar 不能直接访问 SQLite。
4. 内部 tool token 必须与 `AGENT_RUNTIME_TOKEN` 区分或统一收口，不允许无 token 内部调用。
5. 所有 action execute、proposal create、confirm、reject 都写审计。
6. View intent 必须白名单校验。
7. Memory 可删除、可 mute，不作为业务事实。
8. Proactive task 默认不执行写操作。

---

## 15. 测试与 Smoke

每个 PR 最低要求：

```bash
npm run lint
npx tsc --noEmit
npm run build
```

涉及 schema：

```bash
npx prisma db push
```

Demo 切换前 smoke：

1. 未登录 `/api/agent/chat-sessions` 返回 401。
2. 登录后可创建会话。
3. `/agent` 发送消息，刷新后消息仍在。
4. 多轮 tool loop 可完成唯一项目摘要。
5. confirm action 只生成 proposal。
6. proposal confirm 后写业务数据和 `AgentActionLog`。
7. `/compact` 后继续追问能用到旧上下文。
8. memory 保存后下一轮注入，删除后不再注入。
9. web search 可用，不配置时提示。
10. view intent 无权限对象无法 apply。
11. proactive task 未确认不会调度。
12. demo service active，`/agent` 返回 200。

---

## 16. 回滚策略

任何阶段出现问题：

1. 将 `AGENT_RUNTIME=legacy`。
2. 保留新表，不删除数据。
3. `/api/agent/chat` 继续走旧 planner。
4. `/agent` 前端若已切新 UI，应支持 legacy response adapter。
5. sidecar service 可停，不影响主站。

只有在 demo 和生产稳定一个版本周期后，才删除 legacy planner。

---

## 17. 明确不做

第一轮迁移不做：

1. 不让 sidecar 直接执行 shell。
2. 不让 sidecar 直接改数据库。
3. 不把所有业务 API 自动转 tool。
4. 不做完全自主的后台 agent。
5. 不做未经确认的高风险写入。
6. 不把 memory 当作客户/项目/订单事实库。
7. 不实现任意 URL 跳转。

这些限制是为了把基础打稳，后续能力通过受控 tool 和 intent 增量开放。

