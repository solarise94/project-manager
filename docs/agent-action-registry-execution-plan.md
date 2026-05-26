# Agent Action Registry 执行计划

## 1. 文档定位

这份文档不再描述一个“从零开始的未来方案”，而是作为当前 `/agent` 能力的基线设计稿和后续执行计划。目标是把已经落地的 action registry、proposal/confirm、AgentRun、`/agent` UI、MiniMax 驱动链路统一收口，避免后续继续按旧计划分叉实现。

适用范围：

1. 统一注册业务 action，并按需暴露给页面 API、manager AI、`/agent` 工作台。
2. 让 manager AI 继承当前登录用户权限，而不是绕开 NextAuth 和现有业务权限守卫。
3. 为后续继续扩 action、补会话能力、必要时外接 sidecar，提供稳定边界。

---

## 2. 当前结论

当前项目已经基本落在此前建议的 C 路线：

1. 保留现有业务后台页面和 API，不推翻现有系统。
2. 新增独立 `/agent` 工作台，承担“查询 + 草稿 + 待确认动作”的前端入口。
3. 权限边界继续放在 Next.js 后端，不把 sidecar 或 manager AI 当权限边界。
4. 用“业务 action 注册层”而不是“把全部 `route.ts` 自动转 tool”的方式扩展能力。

当前实现不是“额外再起一个完整 agent 后端”，而是：

1. 在 Next.js 内部建立 action registry。
2. 用 `AgentRun` 记录一次 AI 会话的运行上下文。
3. 用 `/api/agent/tools/execute` 作为受控工具执行入口。
4. `/api/agent/chat` 复用现有 MiniMax 配置做规划和总结。

这条路径满足现阶段目标，而且比“新起一套 agent 前后端并复制权限体系”更稳。

---

## 3. 核心架构

### 3.1 设计原则

1. AI 只能做“当前登录用户本来就能做的事”。
2. Tool 代表高层业务动作，不等于页面 API 的机械透传。
3. 高风险写操作统一走 `proposal -> user confirm -> execute`。
4. 现有权限函数、Prisma 查询、业务服务继续复用，不在 agent 层重复造一套。
5. 后续若增加 sidecar，也只能是模型执行层，不能接管权限判断。

### 3.2 当前链路

```text
/agent 页面
  -> /api/agent/chat
    -> getServerSession(authOptions)
    -> getOrCreateAgentRunFromSession()
    -> listAvailableAgentActions(actor)
    -> MiniMax 规划 tool_calls
    -> /api/agent/tools/execute
      -> AgentRun / session 还原 ActorContext
      -> action registry
      -> 复用现有业务逻辑与权限守卫
      -> 写 AgentActionLog / AgentProposal
    -> MiniMax 汇总结果
    -> 返回消息、toolRuns、proposals、agentRunId
```

直接调试链路：

```text
浏览器 / 调试请求
  -> /api/agent/actions
  -> /api/agent/tools/execute
    -> session actor 或 agentRun actor
    -> action registry
```

### 3.3 为什么不直接“把全部 API 转成 tool”

原因不是技术上做不到，而是代价和风险不合适：

1. 现有 API 很多是页面专用接口，参数/返回值偏 UI 形态，不适合直接给 AI。
2. API 的职责里夹着 session、query 解析、分页、展示字段，直接映射后会让 tool 很脆。
3. manager AI 更适合调用“搜索项目”“生成项目草稿”“准备开票草稿”这种业务动作，而不是调用几十个底层页面端点再自己编排。
4. 真正的权限边界仍需回到业务层，因此应该先抽 action，而不是先抽 transport。

---

## 4. 已落地能力

### 4.1 目录结构

当前已形成以下模块：

```text
src/lib/agent-actions/
  actor.ts
  errors.ts
  logs.ts
  proposals.ts
  registry.ts
  run-context.ts
  tool-adapter.ts
  draft-helpers.ts
  types.ts
  actions/
    index.ts
    projects.ts
    orders.ts
    crm.ts
    finance.ts
    tickets.ts

src/app/api/agent/
  actions/route.ts
  chat/route.ts
  proposals/route.ts
  proposals/[id]/confirm/route.ts
  proposals/[id]/reject/route.ts
  tools/execute/route.ts

src/app/agent/page.tsx
src/components/agent/
  agent-workbench.tsx
  chat-panel.tsx
  action-result-panel.tsx
  proposal-panel.tsx
```

### 4.2 当前 action 范围

已实现的安全只读 action：

1. `projects.search`
2. `projects.get_summary`
3. `orders.search`
4. `orders.get_finance_snapshot`
5. `crm.search_customers`

已实现的 confirm action：

1. `crm.create_followup_task`
2. `orders.link_to_project`
3. `finance.prepare_invoice_draft`
4. `tickets.create_from_text`

已实现的 draft action：

1. `projects.draft_from_text`

其中：

1. `tickets.create_from_text` 会先抽取结构化输入，再落 proposal，confirm 时不重复跑 AI。
2. `projects.draft_from_text` 复用了现有 draft / plugin 体系，而不是另起一套文本解析链。

### 4.3 审计与 proposal

已增加 Prisma 模型：

1. `AgentActionLog`
2. `AgentProposal`
3. `AgentRun`

并且：

1. `AgentActionLog`、`AgentProposal` 已可关联 `agentRunId`。
2. confirm / reject / execute 都会写审计轨迹。
3. proposal 的输入会持久化，确认时按存量输入重放，不依赖前端再次传参。

### 4.4 会话上下文

当前并没有外部 sidecar 进程，但已经具备“等价运行上下文存储”：

1. `AgentRun` 持久化 `userId`、`role`、`name`、`email`、`source`、`status`、`lastUsedAt`。
2. `/api/agent/chat` 为每次会话创建或复用 `AgentRun`。
3. `/api/agent/tools/execute` 在内部模式下只信任 `agentRunId`，不信任外部传来的 `userId` / `role`。

这已经满足“manager AI 继承用户权限”的关键要求。

### 4.5 UI 形态

`/agent` 已经独立存在，并采用偏短信/对话式的工作台布局，而不是把现有后台页面塞进聊天壳：

1. 左侧是 action 目录与筛选。
2. 中间是聊天面板。
3. 右侧是最新 action 结果和 proposal。

这个方向是对的。它和 `~/blueprint_re_v3` 的思路接近，但不是直接照抄界面。

---

## 5. 当前稳定契约

### 5.1 ActorContext

当前 actor 上下文应继续保持这个边界：

```ts
export interface ActorContext {
  userId: string;
  role: string;
  name?: string | null;
  email?: string | null;
  agentRunId?: string | null;
}
```

约束：

1. 浏览器请求默认从 NextAuth session 生成 actor。
2. 内部 tool 执行默认从 `agentRunId` 反查 actor。
3. 不接受 sidecar 或前端直接提交可信 `userId` / `role`。

### 5.2 AgentActionDefinition

当前 action 注册契约已经足够支撑后续扩展：

```ts
export interface AgentActionDefinition<Input, Output> {
  key: string;
  title: string;
  description: string;
  domain: AgentActionDomain;
  riskLevel: AgentActionRiskLevel;
  readOnly: boolean;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  parseInput: (raw: unknown) => Input;
  availability: (actor: ActorContext) => Promise<boolean>;
  execute: (actor: ActorContext, input: Input) => Promise<Output>;
  buildProposal?: (actor: ActorContext, input: Input) => Promise<AgentProposalDescriptor>;
  resolveTarget?: (input: Input, output: Output) => Promise<AgentActionTarget | null> | AgentActionTarget | null;
}
```

使用原则：

1. `parseInput()` 负责运行时校验，不强制引入新 schema 库。
2. `inputSchema` / `outputSchema` 面向工具层和 UI 描述。
3. `availability()` 只回答“此用户是否允许看到/使用这个动作”。
4. 具体 scope、字段裁剪、对象级权限检查仍在 `execute()` 内完成。

### 5.3 风险等级

继续固定三档：

1. `safe`：可直接执行。
2. `confirm`：只能先生成 proposal。
3. `restricted`：保留给后续更严格的人机协同场景，目前不建议开放。

当前规则：

1. `/api/agent/tools/execute` 遇到 `confirm`，返回 `202 + proposal`，不直接执行。
2. 真正执行只发生在 `/api/agent/proposals/[id]/confirm`。

---

## 6. API 设计基线

### 6.1 `GET /api/agent/actions`

用途：

1. 返回当前用户可见 action 列表。
2. 同时返回可给 manager AI 使用的 tool schema。

当前输出形态：

```json
{
  "actions": [
    {
      "key": "orders.search",
      "title": "搜索订单",
      "description": "按关键词和条件搜索当前用户可见的订单",
      "domain": "orders",
      "riskLevel": "safe",
      "readOnly": true,
      "inputSchema": {},
      "outputSchema": {}
    }
  ],
  "tools": [
    {
      "name": "orders.search",
      "description": "按关键词和条件搜索当前用户可见的订单",
      "input_schema": {}
    }
  ]
}
```

保留原则：

1. action 元信息给前端。
2. tool schema 给 manager AI。
3. 不暴露内部实现细节。

### 6.2 `POST /api/agent/tools/execute`

用途：

1. 统一执行 safe action。
2. 对 confirm action 统一生成 proposal。
3. 既支持登录用户直调，也支持 chat 内部调用。

当前认证路径：

1. 外部路径：NextAuth session。
2. 内部路径：`x-agent-internal-token + agentRunId`。

当前响应模式：

```json
{
  "ok": true,
  "actionKey": "orders.search",
  "mode": "result",
  "result": {}
}
```

或：

```json
{
  "ok": true,
  "actionKey": "tickets.create_from_text",
  "mode": "proposal",
  "proposal": {}
}
```

### 6.3 `GET/POST /api/agent/proposals`

用途：

1. 查询当前用户 proposal。
2. 直接创建 proposal。

适用场景：

1. `/agent` 工作台加载待确认动作。
2. 后续也可给非聊天型 UI 挂一个“AI 建议动作”侧栏。

### 6.4 `POST /api/agent/proposals/[id]/confirm`

执行原则：

1. 重新校验 proposal 属于当前用户。
2. 重新加载持久化输入。
3. 再次通过 action 和权限校验后才执行。
4. 执行结果、target、错误信息写回 proposal / action log。

### 6.5 `POST /api/agent/proposals/[id]/reject`

职责很明确：

1. 只改变 proposal 状态。
2. 写拒绝审计日志。
3. 不触发业务写操作。

### 6.6 `POST /api/agent/chat`

当前职责：

1. 用现有 MiniMax provider 做 tool 规划。
2. 通过 `/api/agent/tools/execute` 执行或生成 proposal。
3. 对 tool 结果做二次总结。
4. 返回 `agentRunId` 供前端续聊。

当前不是“独立 agent 服务”，而是“Next.js 内部的 manager chat orchestration”。

这在现阶段是合理的，因为：

1. 权限、日志、proposal、业务逻辑都在同一处。
2. 现有项目没有必要先引入跨进程复杂度。

---

## 7. 权限与安全约束

### 7.1 权限边界

权限边界只能在 Next.js 后端，不能在模型侧：

1. manager AI 不可信。
2. sidecar 不可信。
3. 浏览器 localStorage 不可信。
4. 只有 `getServerSession()`、`AgentRun`、现有业务权限函数可信。

### 7.2 查询类 action 约束

继续遵守项目现有规则：

1. 项目查询复用项目成员和 owner 逻辑。
2. 订单查询必须走 `getOrderScopeWhere()`，并用 `{ AND: [...] }` 合并搜索条件。
3. CRM 查询必须走 `src/lib/crm/permissions.ts` 的现有 scope。
4. 输出字段尽量最小化，不把详情页全量 select 直接返回给 AI。

### 7.3 写操作约束

1. 所有写操作默认 `confirm`。
2. proposal 创建时校验一次权限。
3. proposal confirm 时再校验一次权限。
4. 若业务对象状态已变化，应允许 confirm 失败并返回明确错误。

### 7.4 内部 token 约束

当前内部工具 token 策略：

1. 优先使用 `process.env.AGENT_INTERNAL_TOOL_TOKEN`。
2. 未配置时按进程生成随机 token。
3. 仅用于 Next.js 内部 chat -> tools execute 链路。

它不是最终的跨服务鉴权方案，但足够支撑当前“同进程内部调用”。

---

## 8. UI 设计收口

### 8.1 定位

`/agent` 不是现有业务页面的替代品，而是一个更轻的操作入口：

1. 适合聊天式查询、摘要、草稿生成、待确认动作。
2. 不适合替代复杂批量操作、全字段编辑、表格型管理台。

### 8.2 当前展示方式

当前三栏式方向正确：

1. 左栏：动作目录、筛选、后续应补“最近会话”。
2. 中栏：短信式聊天记录，强调用户问题、工具结果、待确认建议。
3. 右栏：最新结果、proposal、对象摘要。

### 8.3 需要继续细化的 UI

下一步应补齐的不是“大改视觉”，而是让会话概念完整可见：

1. 左栏增加最近 `AgentRun` 会话列表。
2. 顶部增加当前会话 badge，明确显示 `agentRunId` 或可读摘要。
3. 支持“新建会话”，清空当前消息并重新创建 run。
4. proposal 面板应支持按 `PENDING / CONFIRMED / REJECTED` 快速筛选。

### 8.4 为什么不把 agent 直接并进现有页面

不建议把 agent 工作区硬塞进 `/orders`、`/projects`、`/crm` 等页面主流程，原因很实际：

1. 会让专业后台页面变复杂。
2. agent 的交互模型是会话式，不是表单式。
3. proposal / 会话 / tool results 需要独立心智模型。

因此继续保留独立 `/agent` 页面是正确的。

---

## 9. 当前差距与下一步执行计划

下面是“可以直接落代码”的收尾清单，按优先级执行。

### P0. 补齐会话列表与会话切换

目标：把文档里的“会话”真正做完整，而不是只把 `agentRunId` 藏在本地状态里。

改动：

1. 新增 `GET /api/agent/runs`。
2. 复用 `listAgentRunsForUser(userId)` 返回最近会话。
3. `/agent` 左栏增加“最近会话”列表。
4. 支持点击历史会话后切换当前 `agentRunId`。
5. 增加“新建会话”按钮。

文件：

1. `src/app/api/agent/runs/route.ts`
2. `src/components/agent/agent-workbench.tsx`
3. 如有必要，拆出 `session-list-panel.tsx`

验收：

1. 登录用户能看到自己的最近会话。
2. 切换会话后，聊天继续沿用对应 `agentRunId`。
3. 用户不能读取其他人的 `AgentRun`。

### P0. 文档和实现统一“内部执行链路”

目标：明确哪些行为必须走 `/api/agent/tools/execute`，哪些只是 chat 内部预处理。

现状：

1. chat 已通过 `/api/agent/tools/execute` 做正式执行。
2. 但 `normalizePlannedToolCall()` 里还会直接调用 `executeAgentAction()` 做 ID 解析用搜索。

建议：

1. 保留该行为作为“规划期归一化”，因为它本质是内部辅助解析，不是最终动作执行。
2. 但要在文档中明确：它不属于正式业务动作，不作为用户可审计结果的一部分。
3. 若后续需要统一审计，可把这类解析改造成 `search helper action` 并也走 execute API。

### P1. 收口 action 编写规范

目标：后续加 action 时不再各写各的。

需要补成固定模板：

1. `parseInput()` 必须做字段级校验和默认值处理。
2. `availability()` 只做粗粒度能力开关。
3. `execute()` 内必须重新做对象级权限和 scope 合并。
4. `confirm` action 必须实现 `buildProposal()`。
5. 会产生明确业务对象的 action 应实现 `resolveTarget()`。

建议额外整理一个 action checklist：

1. 输入是否最小化。
2. 输出是否泄漏多余敏感字段。
3. 是否正确复用现有权限函数。
4. 是否把 scope 与搜索条件做了 `AND` 合并。
5. 是否在 confirm 前后都做了权限校验。

### P1. proposal 与结果展示收口

目标：让用户能快速理解“已查到什么”和“待确认什么”。

改动建议：

1. chat 内消息里的 proposal 卡片只保留关键摘要。
2. 右侧 `proposal-panel` 展示完整参数摘要和 target。
3. `action-result-panel` 对项目摘要、订单财务摘要做 domain-specific 视图，不只 raw JSON dump。
4. confirm/reject 后在当前会话中插入系统消息，明确执行结果。

### P1. recent state 持久化重构

现状：

1. `localStorage` 当前主要持久化单个 `messages + agentRunId`。

建议：

1. 改为按 `userId + agentRunId` 持久化多会话消息缓存。
2. 左栏 recent runs 只决定当前会话选择。
3. 会话消息的权威上下文仍由前端本地缓存承担，数据库先不存全量聊天文本。

这样可以避免现在切换会话时消息态难以管理的问题。

### P2. 明确 sidecar 接入条件

当前不需要立即上 sidecar。只有满足下面条件，才值得拆：

1. 需要长时间运行的多步 agent。
2. 需要模型会话和 Next.js 生命周期解耦。
3. 需要队列、重试、并发控制或外部 worker。
4. 需要跨模型供应商编排。

在那之前，继续保持“Next.js 内编排 + AgentRun 持久化”更稳。

若以后要接 sidecar，要求不变：

1. sidecar 不接浏览器。
2. sidecar 不持有超级权限。
3. sidecar 只能拿 `agentRunId + internal token` 请求受控 tool execute。
4. 业务权限判断仍在 Next.js。

---

## 10. 适合新增的下一批 action

后续 action 继续围绕“高价值、低歧义、可审计”扩，不要追求覆盖所有 API。

优先级建议：

1. `projects.search_members`
2. `projects.list_recent_tickets`
3. `orders.get_project_links`
4. `crm.list_followups`
5. `finance.get_customer_invoice_snapshot`
6. `tickets.reply_from_text`（confirm）

筛选标准：

1. 用户在聊天里真的经常会问。
2. 输入可以被约束成稳定 schema。
3. 输出可以被压缩成易读摘要。
4. 权限边界清晰。

---

## 11. 不建议现在做的事

1. 不建议把现有 166 个 API route 全部注册成 tool。
2. 不建议把 `/agent` 直接混进现有 `/orders` 或 `/projects` 主页面。
3. 不建议让 manager AI 直接拿数据库权限或内部超级 token。
4. 不建议为了“像 agent”而先拆独立服务进程。
5. 不建议现在就把完整聊天消息持久化进数据库，先把 run / proposal / action log 做扎实。

---

## 12. 阶段验收标准

### 当前基线已满足

1. 登录用户可访问 `/agent`。
2. `/api/agent/actions` 能返回当前用户可用 action。
3. `/api/agent/tools/execute` 可执行 safe action，并对 confirm action 生成 proposal。
4. `/api/agent/chat` 可创建/复用 `AgentRun` 并返回 `agentRunId`。
5. proposal 可查询、确认、拒绝。
6. chat 与 proposal 流程复用现有 MiniMax 配置和现有权限体系。

### 下一阶段验收

1. `/api/agent/runs` 能返回当前用户最近会话。
2. `/agent` 左栏能展示并切换最近会话。
3. “新建会话”能开启新的 `AgentRun`。
4. 会话切换后，tool 执行和 proposal 仍绑定正确用户与 run。
5. 文档、UI、API 对“会话 / proposal / action result”三种概念表述一致。

---

## 13. 执行顺序建议

按下面顺序继续最稳：

1. 先补 `GET /api/agent/runs` 和 `/agent` 会话列表。
2. 再整理 `agent-workbench` 的本地多会话缓存结构。
3. 再收口 `proposal-panel` 和 `action-result-panel` 的展示层。
4. 最后再决定是否需要把 chat 内部 ID 归一化也纳入统一审计链。

这四步做完，当前方案就已经是一套可以持续扩展的 manager AI 基座，不必急着进入 sidecar 复杂度。
