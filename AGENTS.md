<!-- 本文件面向 AI 编程助手。CLAUDE.md 通过 @AGENTS.md 引用此文件；请直接编辑这里，不要编辑 CLAUDE.md。 -->

# SciManage — 科研项目管理系统

中文界面的 Next.js 全栈应用，服务于单细胞测序与空间转录组领域的科研项目管理。核心能力包括：项目与工单管理、客户与组织管理、CRM（客户关系管理）、发票与外部订单、AI 辅助草稿填写、以及多角色权限体系。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 App Router, React 19 |
| 语言 | TypeScript 5 (target: ES2017, moduleResolution: bundler) |
| 样式 | Tailwind CSS v4, shadcn/ui (style: base-nova), `@base-ui/react` 部分底层组件 |
| 数据库 | Prisma 5 + SQLite (`prisma/schema.prisma`) |
| 状态管理 | TanStack React Query v5 (服务端), Zustand (客户端) |
| 图表 | Recharts |
| 认证 | NextAuth v4, JWT 策略, Credentials + Representative 双 Provider |
| 构建输出 | `output: "standalone"` (`next.config.ts`) |
| 包管理 | npm |

关键依赖版本锁定在 `package.json` 中，请勿假设 training data 中的 Next.js / React / Tailwind 默认行为——本项目使用大量非默认配置和 Breaking Changes API。

---

## 构建与常用命令

```bash
# 本地开发（读取仓库根目录 .env）
npm run dev

# 生产构建
npm run build

# 代码检查（ESLint flat config，无需额外参数）
npm run lint

# ⚠️ 禁止使用 npm run start（即 next start）
# 验证生产构建请使用 standalone server：
#   node .next/standalone/server.js
# 或指定端口：
#   HOSTNAME=127.0.0.1 PORT=31081 node .next/standalone/server.js

# 数据库 schema 同步到 SQLite（日常开发优先用这个）
npx prisma db push

# 创建迁移（需要保留历史时）
npx prisma migrate dev --name <name>

# 重置并填充种子数据（⚠️ 会清空所有数据）
npx tsx prisma/seed.ts
```

---

## 项目结构与代码组织

```
src/
  app/                    # Next.js App Router
    api/                  # API 路由（每个资源对应 route.ts）
      auth/               # NextAuth 路由
      crm/                # CRM 模块 API
      customers/          # 客户管理 API
      projects/           # 项目管理 API
      tickets/            # 工单 API
      external-orders/    # 外部订单 API
      ...
    crm/                  # CRM 前端页面
    projects/             # 项目前端页面
    customers/            # 客户前端页面
    admin/                # 后台管理页面
    ...
  components/
    ui/                   # shadcn/ui 组件
    crm/                  # CRM 专用组件
    *.tsx                 # 跨页面共享组件
  hooks/                  # React 自定义 Hooks（useMediaQuery 等）
  lib/                    # 核心业务逻辑与工具
    auth.ts               # NextAuth 配置
    prisma.ts             # Prisma Client 单例
    permissions.ts        # 项目级权限守卫
    role-guards.ts        # Client-safe 角色判断（isAdmin/isInternalStaff/canAccessOrders）
    orders/               # 统一订单系统（constants, permissions, types）
    finance/              # 财务模块（progress, calculations, costs, pingoodmice-match, types）
    crm/                  # CRM 业务逻辑、常量、Query Keys、权限
    draft/                # AI 草稿工作流
      form-schemas/       # 表单 Schema（project.create, project.edit, customer.create, ticket.create）
      providers/          # AI Provider 抽象（MiniMax Chat/Vision/Search, 腾讯云 ASR）
    plugins/              # 插件系统
      builtin/            # 内置插件：project-digest, project-smart-fill, project-auto-draft
    mail.ts               # 邮件发送（nodemailer，自动回退 Ethereal）
    reminder.ts           # 工单到期提醒
    external-order.ts     # 外部订单 CSV 解析与标准化 (Legacy)
    export-invoice-pdf.tsx# 发票 PDF 导出（html-to-image + jsPDF）
    feishu-export.ts      # 飞书多维表格导出格式
    app-url.ts            # 集中式 URL 构建器
    runtime-info.ts       # 运行时环境探测（DEV/DEMO/PROD）
    ...
prisma/
  schema.prisma           # 完整数据模型
  seed.ts                 # 种子数据（含默认管理员账号）
  dev.db                  # 开发环境 SQLite 文件
scripts/
  deploy-standalone.sh    # 底层部署脚本
  deploy-demo.sh          # Demo 环境部署
  deploy-prod.sh          # 本机生产镜像/预演部署（非正式线上）
  deploy-remote-prod.sh   # 正式线上部署（远程 101 服务器）
  mobile-screenshot.py    # 移动端截图工具（Python + Playwright）
public/
  uploads/                # 用户上传文件（照片、附件）
.claude/
  rules/                  # 项目级规则（自动加载到上下文）
  skills/                 # 自定义本地 Skills
  settings.local.json     # 本地设置覆盖
.mcp.json                 # MCP 服务器配置（Context7）
```

路径别名：`@/*` → `./src/*`。

---

## 开发规范与代码风格

- **Tailwind CSS v4**：没有 `tailwind.config.ts`。自定义 token 在 `src/app/globals.css` 的 `@theme inline { ... }` 中定义，暗黑模式用 `@custom-variant dark`。
- **shadcn/ui**：style 为 `"base-nova"`（非默认）。部分 Dialog 使用 `@base-ui/react` 的 `DialogTrigger render=` 模式。
- **ESLint**：flat config (`eslint.config.mjs`)，继承 `eslint-config-next/core-web-vitals` + `typescript`，关闭了 `@next/next/no-img-element`。
- **API 路由标准模式**：每个 `route.ts` 必须内联调用 `getServerSession(authOptions)` 进行认证，不存在 `middleware.ts`。
- **页面组件**：均为 `"use client"`，认证通过 `useSession()` + 客户端重定向实现。
- **`useSearchParams`**：使用 `useSearchParams()` 的页面必须用 `<Suspense>` 包裹，否则 build 阶段报 `missing-suspense-with-csr-bailout`。标准模式：`export default function Page() { return <Suspense fallback={...}><Inner /></Suspense>; }`，Inner 为实际组件。
- **Prisma 单例**：始终从 `@/lib/prisma` 导入 `prisma`，禁止直接 `new PrismaClient()`。
- **URL 构建**：禁止手动拼接 `process.env.NEXTAUTH_URL`，统一使用 `@/lib/app-url` 中的 `getAppBaseUrl()` / `getAppUrl()` / `getMagicLinkUrl()`。
- **打印/PDF**：`globals.css` 中 `@media print` 规则会隐藏 `#invoice-print-root` 以外的全部内容。新增打印友好视图请遵循此模式。
- **无测试框架**：当前未配置任何测试框架，也没有项目级测试。新增测试需从零搭建。
- **Scope 查询 AND-composition**：Order/Cost/Invoice API 中 scope WHERE 与用户搜索/筛选条件必须通过 `{ AND: [scopeWhere, searchOR, filters] }` 合并，严禁直接覆盖 where 对象，否则会导致 scope 绕过。
- **Per-row $transaction**：导入/批量写入涉及多表（Order + OrderSourceRecord + OrderLine）的操作用 `prisma.$transaction()` 包住，防止中途失败产生孤儿数据。幂等检查优先查 OrderSourceRecord uniqueness。
- **deep-link 预填**：页面从 URL query 读取预填参数后，用 `useRef` 或 `prefilledProjectIdRef` 跳过重复预填，避免 useEffect 覆盖用户手动修改。

---

## 认证与权限

- **无 middleware.ts**：路由不由中间件保护。每个 API route 内联调用 `getServerSession(authOptions)`，页面靠 `useSession()` + 客户端跳转。
- **标准认证导入**：
  ```ts
  import { getServerSession } from "next-auth";
  import { authOptions } from "@/lib/auth";
  ```
- **Provider**：
  - `credentials`：邮箱 + 密码登录（bcryptjs 哈希）。
  - `representative`：Magic Link 单点登录（24h 有效期，单次使用，使用后清空 token）。
- **暴力破解防护**：5 次失败 → 锁定 15 分钟，通过 `FailedLoginAttempt` 模型跟踪；触发锁定时自动邮件通知所有 ADMIN。
- **角色等级（升序）**：`REPRESENTATIVE` < `USER` < `ADMIN`
- **销售用户自动创建**：Representative 首次 Magic Link 登录时，`ensureSalesUserForRepresentative()` 自动创建 `role="REPRESENTATIVE"` 的 User 行。`ADMIN` / `USER` 角色的邮箱被拒绝销售用户绑定。
- **权限守卫**（`src/lib/permissions.ts`）：
  - `isProjectMember` / `assertProjectMember`
  - `isProjectOwner` / `assertProjectOwner`
  - `getUserProjectIds` / `getRepresentativeProjectIds`
  - `assertProjectContextReadable`（ADMIN 绕过成员检查；已删除项目仅 ADMIN / OWNER 可见）
- **CRM 权限**（`src/lib/crm/permissions.ts`）：CRM 资料按 `ownerUserId` 隔离。ADMIN 可见全部，普通用户仅可见自己拥有的资料。`REGIONAL_MANAGER` 可见下辖代表的资料。
- **Session**：携带 `user.id` 和 `user.role`，最大有效期 30 天。

---

## 数据模型概要

Prisma + SQLite（`prisma/schema.prisma`）。核心实体：

- **User**：系统用户，含通知偏好（`emailOnReminder` 等）。
- **Representative**：外部代表/销售，含 `archived` 标志、Magic Link token。
- **Organization**：组织机构，含 `orgCode`（唯一）、canonicalName、normalizedName；支持多别名（`OrganizationAlias`）和多校区/站点（`OrganizationSite`，自引用 `parentSiteId`）。
- **Customer**：客户，含 `labOrGroup`、软删除、合并支持（`mergedIntoId`）。
- **Project**：项目，含成员（`ProjectMember`，角色 OWNER/MEMBER）、状态历史（`StatusHistory`）、软删除（`deleted`/`deletedAt`/`deletedReason`）。
- **Ticket / TicketReply**：工单与回复，支持提醒日期（`reminderDate`）。
- **Comment / Attachment / ActivityLog / Notification**：评论、附件、活动日志、站内通知。
- **BillingProfile / ProjectInvoice / ExternalOrderInvoiceRequest**：开票方档案、项目发票、外部订单开票申请，均支持行项目。
- **Order / OrderLine / OrderSourceRecord**：统一订单模型（PR 1-10 引入，替代 ExternalOrder）。支持手动创建（source=MANUAL）、拼好鼠导入（source=PINGOODMICE）、其他导入。`OrderSourceRecord` 维护 legacy ExternalOrder 的字段镜像与 raw JSON，`OrderLine` 替代 ExternalOrder 的单体金额。
- **OrderProjectLink**：Order 与 Project 的多对多关联，含 `treatment`（PROJECT_INCLUDED/STANDALONE）、`allocatedAmount` 分摊、`isPrimary` 主关联。
- **OrderStatusHistory**：订单状态变更日志。
- **OrderMerge**：订单合并关系（sourceOrder → targetOrder）。
- **OrderInvoiceCoverage**：统一订单发票的覆盖记录（`orderId + invoiceRequestId`），与 legacy `ExternalOrderInvoiceCoverage` 并行为双覆盖模型。
- **FinanceCost**：独立成本跟踪（`costType`、`amount`、`occurredAt`），支持关联 customer/order/project。
- **ExternalOrder / ExternalOrderImportBatch**：Legacy 外部订单表，只读追溯，所有写操作已迁移到 Order 模型。
- **ExternalOrderInvoiceRequest**：发票申请（项目发票和订单发票共用）。`orderId`（可选）直接关联 Order，`externalOrderId`（可选）关联 legacy ExternalOrder。两套 coverage 模型并存。
- **OrganizationReviewTask**：AI 辅助机构去重审核工作流。
- **DevLog**：应用内版本更新日志。
- **FailedLoginAttempt**：暴力破解锁定跟踪。

### CRM 数据模型

- **CrmCustomerProfile**：销售资料，绑定到 Customer，含阶段、重要性、标签、摘要、归档标志、人员分类（`personCategory`）、职位、毕业日期与提醒。
- **CrmInteraction**：互动记录（电话、微信、邮件、会议、拜访、转介绍、备注）。
- **CrmFollowUpTask**：跟进任务（待处理/已完成/已取消/已过期）。
- **CrmVisitCheckin / CrmVisitMedia**：GPS 拜访签到与照片。
- **CrmCustomerAddress**：客户地址，含地理编码（省/市/区），来源类型与主地址标志。
- **CrmCustomerRelation**：客户间关系边（介绍、协作、汇报、同课题组、同实验室、其他），部分类型为对称关系。
- **CrmCustomerApplication**：新客户申请/ intake 表单。
- **CrmRegionManager / CrmRegionManagerRepresentative**：区域经理与下辖代表的绑定。
- **CrmCustomerAssignmentLog**：客户分配/回收流转日志。

CRM 常量、颜色映射（Tailwind class + Hex 双版本）、Query Key Factory 均位于 `src/lib/crm/`。

---

## 数据库环境

各环境使用完全隔离的 SQLite 数据库，严禁混用：

| 环境 | 路径 |
|------|------|
| 开发 | `prisma/dev.db`（仅本地 `npm run dev`） |
| Demo | `/home/solarise/task-manager-data/demo/dev.db` |
| 本机生产镜像/预演 | `/home/solarise/task-manager-data/prod/dev.db` |
| 正式线上生产 | 远程 `101.34.158.217:/home/ubuntu/task-manager-data/prod/dev.db` |

**注意**：`/home/solarise/project-manage/dev.db` 不是正常路径，若存在通常是调试残留。

---

## 构建与部署

### Standalone 构建规则

本项目使用 `output: "standalone"`。验证或运行生产构建时**严禁**使用 `next start`，否则会导致运行时模块解析失败，表现为登录页正常但 `/api/auth/*` 返回 500。

正确方式：
- 本地验证：`node .next/standalone/server.js`
- 已部署目录：`node server.js`

### 部署脚本

| 脚本 | 目标目录 | 数据库 | 服务名 | 监听地址 |
|------|---------|--------|--------|---------|
| `deploy-demo.sh` | `/home/solarise/task-manager-demo` | `/home/solarise/task-manager-data/demo/dev.db` | `task-manager-demo.service` | `127.0.0.1:31081` |
| `deploy-prod.sh` | `/home/solarise/task-manager` | `/home/solarise/task-manager-data/prod/dev.db` | `task-manager.service` | `0.0.0.0:31080` |
| `deploy-remote-prod.sh` | 远程 `101.34.158.217:/home/ubuntu/task-manager` | 远程 `/home/ubuntu/task-manager-data/prod/dev.db` | `task-manager.service` | `127.0.0.1:31081` |

**正式线上生产只使用 `scripts/deploy-remote-prod.sh`。** 用户说“线上”“生产”“prod”时，默认指远程 `101.34.158.217` 服务器，而不是本机 `/home/solarise/task-manager`。`scripts/deploy-prod.sh` 仅用于本机生产镜像/预演，除非用户明确要求部署到本机 prod。

远程正式生产的公网 HTTPS 由远程 nginx 监听 `0.0.0.0:31080` 提供，反代到 Next.js standalone 的 `127.0.0.1:31081`；外网地址为 `https://task.solarise94.fun:31080`。

本机 demo / 本机生产镜像脚本调用 `deploy-standalone.sh`，流程为：完整构建 → rsync standalone 输出 → Prisma client shim 生成 → `prisma db push` → 重写运行时 `.env` → systemd 服务重启 → 健康检查（`/api/auth/session` 200）。

远程正式生产脚本 `deploy-remote-prod.sh` 会本地构建 → SSH/rsync 到 `101.34.158.217` → 拉取远程 SQLite 到本地临时目录执行 `prisma db push` → 上传更新后的远程库 → 写远程 `.env` 和 systemd unit → 重启远程服务 → 在远程服务器本机 smoke test `127.0.0.1:31081/api/auth/session`。

### 关键部署注意事项

- **`outputFileTracingExcludes`**：`next.config.ts` 中的 `*` 模式排除了 `CLAUDE.md`、`AGENTS.md`、`docs/**`、`scripts/**`、`prisma/**`、`dev.db` 等。新增需要读取项目根目录文件的路由时，必须先检查此排除列表。
- **Prisma CLI 无法在部署目录运行**：`prisma db push` 始终在源码仓库执行。
- **Prisma client shims**：standalone 构建可能引用哈希化的 Prisma client 包名（如 `@prisma/client-2c3a283f134fdcb6`），部署脚本会自动创建 re-export shim。
- **数据库策略**：默认 `fail`——若运行时数据库缺失则直接拒绝部署，不会静默回填。首次部署可使用 `bootstrap` 策略。
- **持久化配置**：数据库目录旁的配置文件（`smtp.conf`、`minimax.conf`、`tavily.conf`、`tencent-asr.conf`、`tencent-map.conf`、`app.conf`）在重新部署后仍然保留。

### `.env` 双轨制

- **仓库根目录 `.env`**：仅本地开发使用。
- **运行时 `.env`**（如 `/home/solarise/task-manager/.env`）：由部署脚本自动生成，systemd 服务读取。修改仓库 `.env` **不会**影响已部署服务。

---

## 核心子系统

### CRM 模块

客户管理叠加在 Customer 模型之上：
- **客户资料**（`/crm/customers`）：按负责人隔离的销售阶段跟踪。阶段：`NEW` → `CONTACTED` → `FOLLOWING` → `ACTIVE` / `BLOCKED` / `LOST` / `DORMANT`；重要性：`LOW` / `NORMAL` / `HIGH` / `KEY`。
- **互动记录**：每资料下的电话、微信、邮件、会议、拜访、转介绍、备注。
- **跟进任务**（`/crm/follow-ups`）：带到期日、负责人、状态的任务列表。
- **拜访签到**：GPS 坐标打卡 + 照片上传，使用腾讯地图 API 进行逆地理编码（`src/lib/crm/geocode.ts`）。
- **关系网络**（`/crm/relations`）：有向/无向客户关系边。
- **客户地址**：支持手动录入、项目导入、外部订单导入、拜访签到四种来源。
- **客户申请**（`/crm/customer-applications`）：新客户 intake 流程。
- **关系图谱**（`/crm/graph`）：D3 force-directed 图可视化。
- **地图**（`/crm/maps`）：客户地址地图可视化。
- API 位于 `src/app/api/crm/`；Query Key Factory 在 `src/lib/crm/query-keys.ts`。

### 插件系统

`src/lib/plugins/` — 可扩展插件架构，当前支持两种能力：
- `timeline`：分析项目上下文并生成时间线摘要。
- `form-draft`：根据非结构化输入自动填充表单字段。

内置插件（`builtin/`）：`project-digest`、`project-smart-fill`、`project-auto-draft`。通过 `registry.ts` 懒加载注册，`/api/plugins` 暴露给前端。

### AI / 草稿工作流

`src/lib/draft/` — 多步 AI 草稿流水线：
- **实体解析**：客户名/单位名先走数据库模糊匹配，多候选时由用户在预览中选择。
- **搜索补齐**：低置信度 + `searchable` 字段触发 Tavily / MiniMax Search 补齐。
- **两段式 LLM**：Pass 1 抽取 → 实体绑定 → 搜索补齐 → Pass 2 定稿。
- **多模态输入**：文本、图片（VLM OCR）、语音（腾讯云 ASR）。
- **Provider 抽象**：`draft/providers/` 支持 MiniMax Chat / Vision / Search、腾讯云一句话识别。
- **表单 Schema**：`draft/form-schemas/` 定义字段元数据（`entityType`、`searchable`、`normalizer`、`enumValues`）。

### 发票系统

- **BillingProfile**：卖方开票档案，ADMIN 管理。
- **ProjectInvoice**：项目发票申请，支持多行项目明细，可导出 PDF（`html-to-image` → `jsPDF`）。
- **ExternalOrderInvoiceRequest**：基于外部订单的开票申请，可自动预填收货人信息。
- **导出格式**：PDF（A4 打印）+ 飞书多维表格制表符分隔文本（`src/lib/feishu-export.ts`）。

### 统一订单系统 (Order Model)

PR 1-10 引入的统一订单中枢，替代 ExternalOrder 作为订单主表。

**数据模型**（`prisma/schema.prisma`）：6 个 Order 家族模型 — `Order`（主表，含 buyer snapshot、customer match、finance 字段）、`OrderLine`（多行明细）、`OrderSourceRecord`（legacy 字段镜像 + raw JSON）、`OrderProjectLink`（多对多项目关联）、`OrderStatusHistory`（状态日志）、`OrderMerge`（合并关系）。

**关键模块**：
- `src/lib/orders/constants.ts` — 枚举常量（`ORDER_SOURCE`、`ORDER_CATEGORY`、`ORDER_STATUS`）、`mapExternalOrderStatus()`、`normalizeOrderSource()`（"微信小商店"/"拼好鼠" → `PINGOODMICE`）
- `src/lib/orders/permissions.ts` — 订单 Scope：ADMIN 全量；USER 限 project-linked / CRM-customer / own-created；REPRESENTATIVE 限自己代表项目关联订单；REGIONAL_MANAGER 合并自己代表项目与下辖代表项目关联订单。
- `src/lib/orders/types.ts` — TypeScript 类型定义

**核心 API**：
- `GET /api/orders` — 列表，支持 AND-composition scope + 13 个筛选参数（source/status/category/customerMatchStatus/financeTreatment/customerId/projectId 等），返回含 projectLinks、customer、invoiceStatus 的完整 select
- `POST /api/orders` — 创建（手动）或带 `projectAction: GENERATE|LINK` 自动生成/绑定项目
- `GET /api/orders/[id]` — 详情，含 lines、projectLinks、sourceRecords、receipts、financeCosts、invoiceRequests、statusHistory
- `PATCH /api/orders/[id]` — 更新（ADMIN-only），支持 customerId/financeTreatment/category/customerMatch* 等全部字段
- `GET /api/orders/[id]/project-links` — 查看关联项目
- `POST /api/orders/[id]/project-links` — 绑定项目，含 customer 一致性校验（409 冲突 + 双向继承）
- `DELETE /api/orders/[id]/project-links/[linkId]` — 解绑
- `POST /api/orders/import/pingoodmice` — CSV 导入，per-row `$transaction`（Order + OrderSourceRecord + OrderLine）

**Finance 模块** (`src/lib/finance/`)：
- `progress.ts` — `getOrderEffectiveTreatment()`（AUTO 时检查 OrderProjectLink 决定 STANDALONE/PROJECT_INCLUDED）、`computeAllProgressReceivables(projects, orders)`
- `calculations.ts` — `getFinanceSummary()`（含 cost/profit 聚合）、`getCustomerFinanceList()`（含 bulk `buildOrderProjectLinkMap`）
- `costs.ts` — `resolveAndValidateCostRefs()` 校验 customer/order/project 一致性
- `pingoodmice-match.ts` — 自动客户匹配扫描（微信/电话/姓名+机构/姓名+地址 四层匹配）
- `types.ts` — `MatchResult`、`MatchScanResult`、`FinanceTreatment` 等类型
- `permissions.ts` — 财务模块权限

**Legacy 接口状态**：7 个旧 ExternalOrder 写 API（`/api/external-orders/import`、`/api/external-orders/batch-delete`、`/api/external-orders/[id]/merge` 等）返回 410 Gone。`/api/finance/pingoodmice/[orderId]/bind-customer`、`bind-project`、`finance-settings` 返回 410，已迁移至 `/api/orders`。

**页面入口**：
- `/orders` — 订单管理中枢，含筛选、URL query 同步、快捷入口（项目/财务/CRM）、ProjectBindDialog
- `/orders/new` — 新建订单（支持 `?fromProjectId=xxx` 预填）
- `/orders/[id]` — 详情（7 tabs: 概览/明细/客户/项目/财务设置/来源记录/操作日志），顶部 action bar
- `/finance/order-matching` — 拼好鼠订单匹配（读 `/api/orders?source=PINGOODMICE`，写 `/api/orders`）
- `/finance/invoices` — 统一发票工作台（含 `orderId` 深链筛选）
- `/finance/costs` — 成本管理（含 `orderId`/`customerId`/`projectId` 深链预填）

### 外部订单 (Legacy)

`src/lib/external-order.ts` — 批量导入来自电商平台的 CSV 订单：
- 支持 GBK/UTF-8 自动检测与转码（`iconv-lite`）。
- 标准化字段映射（`ORDER_HEADER_MAP`）。
- 按 `externalOrderNo` 去重，已存在订单更新而非重复插入。
- `syncOrderInvoiceStatus()` 兼容新旧双路径（legacy `ExternalOrder` + new `Order`）。

**注意**：`ExternalOrder` 表及其 API 仅用于历史数据追溯，所有新读写必须走统一 Order 模型。

### 机构去重与 enrichment

`src/lib/organization-enrichment.ts`、`organization-normalize.ts`、`organization-resolver.ts`、`organization-review.ts`：
- 客户录入时自动归一化机构名称，查询现有 Organization + Alias。
- 未命中时生成 `OrganizationReviewTask`，由 ADMIN 在后台审核（PENDING → APPROVED / REJECTED）。
- AI 辅助：低置信度时通过 MiniMax / Tavily 搜索补全机构信息。

### 邮件与提醒

`src/lib/mail.ts` — nodemailer SMTP：
- 未配置真实 SMTP 时自动回退到 Ethereal 测试账号（控制台输出预览 URL）。
- `sendMailInBackground()` 用于非阻塞邮件发送，自动更新 `Notification` 记录的 `emailStatus`。

`src/lib/reminder.ts` — 工单到期提醒：
- 扫描 `reminderDate <= now` 且未关闭的工单。
- 创建站内通知，并根据用户偏好发送邮件。
- 开发环境在 `layout.tsx` 中自动启动调度器；生产环境通过外部 cron 调用。

---

## 安全考虑

- **无 middleware.ts**：认证分散在每个 API route 中，不存在全局路由拦截。修改认证逻辑需检查所有相关 API route。
- **密码哈希**：使用 `bcryptjs`，成本因子 12（注册/种子数据）。
- **Magic Link**：24h 过期、单次使用、使用后立即失效。代表归档后禁止登录。
- **文件上传**：媒体文件通过 fileId 引用，存储于 `.draft-media/`（非公开目录，排除在构建追踪和 git 之外）；Vision provider 只接受本地文件路径，拒绝 HTTP / data: URL（防 SSRF）。
- **环境变量隔离**：部署脚本明确区分仓库 `.env` 与运行时 `.env`，避免开发配置泄漏到生产。
- **数据库策略**：部署时缺失运行库默认 `fail` 关闭，防止意外覆盖或静默创建空数据库。
- **MCP 密钥**：`.mcp.json` 中提交了 Context7 API Key。若仓库将公开，需轮换密钥并移入环境变量或未跟踪文件。

---

## Next.js 16 特别说明

- **慢导航修复**：仅加 `Suspense` 不够，必须同时从 route 导出 `unstable_instant`。参考 `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.mdx`。
- **Turbopack**：`next.config.ts` 中配置了 `turbopack.root: process.cwd()`。
- **服务端包外置**：`serverExternalPackages` 包含 `@prisma/client` 与 `prisma`。

---

## 相关文件速查

| 目的 | 文件 |
|------|------|
| 入口布局 | `src/app/layout.tsx` |
| 全局样式 | `src/app/globals.css` |
| 认证配置 | `src/lib/auth.ts` |
| Prisma 单例 | `src/lib/prisma.ts` |
| 权限守卫 | `src/lib/permissions.ts` |
| 角色守卫 (client-safe) | `src/lib/role-guards.ts` |
| Order 权限/Scope | `src/lib/orders/permissions.ts` |
| Order 常量/枚举 | `src/lib/orders/constants.ts` |
| CRM 权限 | `src/lib/crm/permissions.ts` |
| URL 构建 | `src/lib/app-url.ts` |
| 邮件 | `src/lib/mail.ts` |
| 提醒调度 | `src/lib/reminder.ts` |
| 运行时信息 | `src/lib/runtime-info.ts` |
| 外部订单导入 (Legacy) | `src/lib/external-order.ts` |
| 财务计算/汇总 | `src/lib/finance/calculations.ts` |
| 财务进度/口径 | `src/lib/finance/progress.ts` |
| 自动客户匹配 | `src/lib/finance/pingoodmice-match.ts` |
| 成本校验 | `src/lib/finance/costs.ts` |
| 发票 PDF | `src/lib/export-invoice-pdf.tsx` |
| 飞书导出 | `src/lib/feishu-export.ts` |
| 智能填写 | `src/lib/smart-fill.ts` |
| MiniMax | `src/lib/minimax.ts` |
| 机构解析 | `src/lib/organization-resolver.ts` |
| 代表用户同步 | `src/lib/representative-user.ts` |
| 插件注册 | `src/lib/plugins/registry.ts` |
| 草稿编排器 | `src/lib/draft/orchestrator.ts` |
| 部署脚本 | `scripts/deploy-standalone.sh` |
| 远程部署 | `scripts/deploy-remote-prod.sh` |
| 移动端截图 | `scripts/mobile-screenshot.py` |
| Schema | `prisma/schema.prisma` |
| 种子数据 | `prisma/seed.ts` |
| Next.js 配置 | `next.config.ts` |
| ESLint 配置 | `eslint.config.mjs` |
| tsconfig | `tsconfig.json` |
| MCP 配置 | `.mcp.json` |
| 自定义 Rules | `.claude/rules/` |
| 自定义 Skills | `.claude/skills/` |
