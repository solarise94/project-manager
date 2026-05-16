# SciManage API 暴露与 UI 入口完整性审查报告

> 审查时间：2026-05-16  
> 审查范围：全项目 165 个 API 路由、53 个 UI 页面、全部表单组件与快捷功能  
> 审查维度：(1) 应暴露但未暴露的 API；(2) 入口隐藏过深的 API/页面；(3) 填单快捷 API 的 UI 复用缺失

---

## 执行摘要

| 维度 | 发现问题数 | 风险等级 |
|------|-----------|---------|
| 有 API 但 UI 完全未暴露 | 5 项 | 🔴 高 |
| API/页面入口隐藏过深 | 10 项 | 🟡 中 |
| 填单快捷 API 未被复用 | 12 项 | 🟡 中 |
| 批量操作能力缺失 | 4 项 | 🟡 中 |
| 移动端导航缺失 | 1 项 | 🟢 低 |

**核心结论**：后端具备较完善的快捷操作与 AI 辅助能力，但前端 adoption 严重不均。Project/Order/Ticket 的「创建」流程享受了一流体验，而「编辑」流程、CRM 表单、财务发票表单几乎完全缺失智能填单能力。此外，多个页面仅能从 Dashboard 卡片进入，缺乏稳定的 sidebar 导航路径。

---

## 一、有 API 但 UI 完全未暴露（应暴露却缺失）

### 1.1 订单合并 API 无前端调用 🔴

| 项目 | 详情 |
|------|------|
| **API** | `POST /api/orders/merge` |
| **后端能力** | 将 sourceOrder 合并到 targetOrder，已完整实现事务、校验、scope 检查 |
| **前端现状** | **零调用**。订单列表 (`/orders`) 有批量删除、批量开票浮动栏，但**没有任何合并入口** |
| **影响** | 用户只能在订单详情页逐条查看，无法批量合并重复订单 |
| **建议** | 在 `/orders` 批量操作栏增加「批量合并」按钮；或至少在订单详情 action bar 暴露「合并到…」 |

### 1.2 项目发票 AI 草稿 API 无前端调用 🔴

| 项目 | 详情 |
|------|------|
| **API** | `POST /api/projects/[id]/invoice-draft` |
| **后端能力** | 基于项目上下文（客户、联系人、项目内容）AI 生成发票草稿（contactName、invoiceType、contentSummary、items） |
| **前端现状** | **零调用**。`InvoiceFormDialog` 组件虽预留了 `aiDraftUrl` prop，但**所有 4 个调用点全部传 `null`**：
- `/orders/[id]/page.tsx`（创建 & 编辑发票弹窗）
- `/orders/page.tsx`
- `/finance/order-matching/page.tsx`
- `/finance/invoices/page.tsx` |
| **影响** | 一套完整的发票智能预填后端完全闲置 |
| **建议** | 在订单详情页「新建发票」按钮旁增加「AI 预填」入口；或在发票表单内激活 `aiDraftUrl` 调用 |

### 1.3 代表快捷创建 API 无前端调用 🟡

| 项目 | 详情 |
|------|------|
| **API** | `POST /api/representatives/quick-create` |
| **后端能力** | 快捷创建 Representative（当前返回 403 禁用） |
| **前端现状** | **零调用**。`/admin/representatives` 页面只有标准创建表单 |
| **影响** | 低。该 API 本身处于禁用状态，但前端也未为其准备任何 UI |
| **建议** | 若业务需要快捷创建，可解封 API 并在代表管理页增加「快捷创建」模式；否则建议从代码库清理 |

### 1.4 已保存互动语音的 ASR API 无前端调用 🟡

| 项目 | 详情 |
|------|------|
| **API** | `POST /api/crm/interactions/[id]/asr` |
| **后端能力** | 对已经保存的 interaction 关联的语音文件进行转写 |
| **前端现状** | **零调用**。前端在创建 interaction 时使用的是 `/api/crm/interactions/asr-draft`（临时草稿），保存后不再提供「重新转写」或「补充转写」功能 |
| **影响** | 中。用户如果先保存了互动再补传语音，无法触发 ASR |
| **建议** | 在互动详情页增加「语音转文字」按钮，调用此 API |

### 1.5 已保存签到语音的 ASR API 无前端调用 🟡

| 项目 | 详情 |
|------|------|
| **API** | `POST /api/crm/checkins/[id]/asr` |
| **后端能力** | 对已经保存的 visit checkin 关联的语音文件进行转写 |
| **前端现状** | **零调用**。签到流程 (`checkin-flow.tsx`) 只有 GPS + 照片上传，**没有任何语音录入 UI** |
| **影响** | 中。销售外勤拜访时无法口述快速记录，只能打字 |
| **建议** | 在签到流程中增加语音录制按钮，调用此 API 生成拜访摘要 |

---

## 二、API / 页面入口隐藏过深

### 2.1 财务子页面：仅能从 Dashboard 卡片进入 🟡

| 页面 | 当前入口 | 问题 | 建议 |
|------|---------|------|------|
| `/finance/invoice-receipt-detail` | `/finance` Dashboard →「查询工具」卡片 | 无 sidebar 入口，用户离开 dashboard 后难以再次找到 | 在 sidebar「财务管理」下增加二级菜单或折叠分组 |
| `/finance/progress-receivables` | `/finance` Dashboard →「查询工具」卡片 | 同上 | 同上 |
| `/finance/invoice-status` | `/finance` Dashboard →「历史归档」卡片 | 同上；且为 legacy 页面 | 评估是否仍需要，若需要则补充导航 |
| `/finance/project-invoices` | `/finance` Dashboard →「历史归档」卡片 | 同上；项目发票为 legacy 但仍在用 | 同上 |

### 2.2 CRM 子页面：仅能从 Dashboard 卡片进入 🟡

| 页面 | 当前入口 | 问题 | 建议 |
|------|---------|------|------|
| `/crm/customer-pool` | `/crm` Dashboard →「功能入口」卡片 | 无 sidebar 入口，且 visibility 受角色限制 (非 Rep/Admin 可见) | 在 sidebar「CRM管理」下增加「客户公海池」入口 |
| `/crm/my-report` | `/crm` Dashboard →「功能入口」卡片 | Rep-only，无 sidebar 入口 | 在 Rep 角色的 sidebar 中增加「我的周报」 |
| `/crm/my-organizations` | `/crm` Dashboard →「功能入口」卡片 | Rep-only，无 sidebar 入口 | 在 Rep 角色的 sidebar 中增加「我的单位」 |

### 2.3 客户主数据页 (`/customers`)：几乎无入口 🔴

| 页面 | 当前入口 | 问题 | 建议 |
|------|---------|------|------|
| `/customers` | 仅能从 `/orders/[id]` 的客户名称深链进入 | **Sidebar、MobileNav、Dashboard 均无入口**；内部跳转甚至重定向到 `/crm/customers` | 明确 `/customers` 的定位：若已弃用，应在代码中标记 deprecation 并清理路由；若仍需保留，在系统管理或 CRM 中给一个入口 |

### 2.4 机构分析页面：路径迂回 🟡

| 页面 | 当前入口 | 问题 | 建议 |
|------|---------|------|------|
| `/admin/organizations/[id]/analytics` | `/admin/organizations` 列表 → 每行「分析」按钮 | 需要先进入列表再点按钮，尚可接受 | — |
| `/admin/organizations/analytics` | 只能从 `[id]/analytics` 页面的 back-link 进入 | **机构列表本身没有「总览分析」入口**；用户如果不先进入某个机构的分析页，永远看不到总览 | 在 `/admin/organizations` 页面顶部增加「机构分析总览」按钮 |

### 2.5 完全孤儿页面 🔴

| 页面 | 状态 | 建议 |
|------|------|------|
| `/finance/project-receivables` | **零 Link / router.push 引用**，但文件存在 | 确认是否已废弃：若废弃则删除页面；若仍需使用，在 `/finance` dashboard 或 sidebar 中补充入口 |

### 2.6 移动端导航缺失 🟢

| 页面 | 问题 | 建议 |
|------|------|------|
| `/tickets` | 有 sidebar 入口和 dashboard 卡片，但 **MobileNav 底部导航中缺失** | 在 `mobile-nav.tsx` 中补充「工单」入口 |

---

## 三、填单快捷 API 在 UI 上未被复用

### 3.1 AI 草稿面板 (`DraftInputPanel`) 复用极不均衡 🔴

`DraftInputPanel` 是项目最核心的智能填单组件，支持：文本粘贴智能解析、图片 OCR、语音 ASR、实体自动绑定、fallback smart-fill。但仅有 **3 处**使用：

| 表单 | 是否有 DraftInputPanel | 后端 Schema 支持 | 差距 |
|------|----------------------|-----------------|------|
| Project 创建 (`/projects`) | ✅ | `project.create` | — |
| Ticket 创建 (项目页内) | ✅ | `ticket.create` | — |
| Order 创建 (`/orders/new`) | ✅ | `order.create` | — |
| **Project 编辑** | ❌ | `project.edit` ✅ | **后端已支持，UI 未接入** |
| **Customer 创建/编辑** (主数据页) | ❌ | `customer.create` ✅ | **后端已支持，UI 未接入** |
| **Order 编辑** | ❌ | 无专属 schema，但可复用 `order.create` | **可接入** |
| **Invoice 创建/编辑** | ❌ | 无 | 可利用 `/api/projects/[id]/invoice-draft` |
| **CRM Follow-up** | ❌ | 无 | 需新建 schema |
| **CRM Checkin** | ❌ | 无 | 需新建 schema |

**建议优先级**：
1. **Project 编辑** → 直接复用 `DraftInputPanel`，`formKey="project.edit"`，fallback 到 `project.smart-fill`
2. **Customer 创建** → 在客户主数据创建弹窗中引入 `DraftInputPanel`，`formKey="customer.create"`
3. **Order 编辑** → 在订单编辑弹窗中引入 `DraftInputPanel`，复用 `order.create` schema + `order.smart-fill`

### 3.2 机构解析 (`/api/organizations/resolve`) 未在 Project/Order 表单复用 🟡

| API | 当前使用处 | 应复用但未复用 | 影响 |
|-----|----------|--------------|------|
| `POST /api/organizations/resolve` | `CustomerApplicationFormDialog`、`CustomerEditDialog` (2处) | Project 创建/编辑表单、Order 创建/编辑表单 | 用户在项目/订单中输入机构名时，无法享受模糊匹配和自动绑定，只能依赖 `OrganizationSelect` 的下拉搜索 |

**建议**：在 Project/Order 表单的机构字段中，集成 `OrganizationSelect`（已含 quick-create），或至少在后端保存前增加 `resolve` 调用。

### 3.3 机构 AI 填充 (`/api/organizations/ai-draft`) 仅限 Admin 🟡

| API | 当前使用处 | 应复用但未复用 | 影响 |
|-----|----------|--------------|------|
| `POST /api/organizations/ai-draft` | `/admin/organizations`、`/admin/organization-reviews` | CRM 客户申请表单、Project 创建表单 | 非 Admin 用户在录入机构时无法享受 AI 补全（如自动填充税号、地址、官网） |

### 3.4 发票 AI 草稿功能全局禁用 🔴

| 组件 | 能力 | 实际状态 |
|------|------|---------|
| `InvoiceFormDialog` | 支持 `aiDraftUrl` prop，内置 `handleAiDraft` + `applyAiDraft` + 预览 UI | **所有调用点传 `null`** |
| 后端 `POST /api/projects/[id]/invoice-draft` | 基于项目上下文生成发票草稿 | **零调用** |

**建议**：在以下场景默认启用：
- 从项目详情页点击「新建发票」时，自动传入 `aiDraftUrl`
- 从订单详情页点击「新建发票」时，若订单已关联项目，自动传入 `aiDraftUrl`

### 3.5 Voice / ASR 实现碎片化 🟡

项目中有 **3 套独立的语音录制实现**，互不复用：

| 实现 | 使用处 | 能力 |
|------|--------|------|
| `DraftInputPanel.VoiceRecorder` | Project 创建、Ticket 创建、Order 创建 | 调用 `/api/draft-media/asr` |
| `CrmVoiceInput` | CustomerApplicationFormDialog | 调用 `/api/draft-media/asr` |
| InteractionForm 自定义 `MediaRecorder` | CRM 互动创建 | 调用 `/api/crm/interactions/asr-draft` |

**问题**：
- `CrmVoiceInput` 只在客户申请中使用，CRM 互动表单没有复用它，而是重复造轮子
- CRM 跟进、CRM 签到、Project 编辑、Customer 编辑完全没有语音入口

**建议**：
- 将 `CrmVoiceInput` 提取为通用语音输入组件，供所有 CRM 表单复用
- 在 Project 编辑、Customer 编辑中直接复用 `DraftInputPanel`（自带 VoiceRecorder）

### 3.6 Ticket 创建无 fallback plugin 🟢

| 表单 | fallbackPlugin | 问题 |
|------|---------------|------|
| Project 创建 | `project.smart-fill` ✅ | AI 不可用时降级到规则填充 |
| Order 创建 | `order.smart-fill` ✅ | 同上 |
| Ticket 创建 | **未配置** ❌ | AI 不可用时完全无智能辅助 |

**建议**：为 Ticket 创建配置 `fallbackPlugin`，或复用 `project.smart-fill` 的通用文本解析逻辑。

---

## 四、批量操作能力缺失

### 4.1 合并操作：全部只有单行，无批量 🟡

| 资源 | API | 前端能力 |
|------|-----|---------|
| 客户 (`/customers`) | `POST /api/customers/[id]/merge` | 仅每行「合并」按钮 |
| 机构 (`/admin/organizations`) | `POST /api/organizations/[id]/merge` | 仅每行「合并」按钮 |
| 订单 (`/orders`) | `POST /api/orders/merge` (专用) | **完全无 UI** |

**建议**：在列表页增加多选 + 批量合并工具栏。订单合并尤其紧迫，因为导入的电商订单经常产生重复。

### 4.2 CRM 客户池：无批量指派/回收 🟡

| API | 前端能力 |
|-----|---------|
| `POST /api/crm/customer-pool/[profileId]/assign` | 仅单行「指派」 |
| `POST /api/crm/customer-pool/[profileId]/recall` | 仅单行「回收」 |

**建议**：在 `/crm/customer-pool` 页面增加多选 + 批量指派/回收工具栏。

---

## 五、遗留 / Debug API 建议清理

以下 API 不属于正常业务，建议评估是否保留：

| API | 状态 | 建议 |
|-----|------|------|
| `/api/test-email` | Debug 专用，无 UI | 保留（开发需要），但加更严格的 dev-only 守卫 |
| `/api/runtime-info` | Debug 专用，需特殊 header | 同上 |
| `/api/reminders/check` | 疑似 legacy，无 UI | 检查是否可被 `/api/internal/reminders/run` 替代，若冗余则删除 |
| `/api/register` | 返回 403，注册功能关闭 | 确认业务是否永久关闭自助注册，若关闭建议从路由层移除或明确注释 |

---

## 六、整改优先级矩阵

| 优先级 | 问题 | 涉及的文件/模块 | 预估工作量 |
|--------|------|----------------|-----------|
| **P0** | 订单合并 API 无 UI (`/api/orders/merge`) | `/orders/page.tsx` | 中 |
| **P0** | 发票 AI 草稿全局禁用 | `InvoiceFormDialog` + 4 个调用点 | 小 |
| **P1** | Project 编辑缺失 AI 草稿 | `/projects/[id]/page.tsx` 编辑弹窗 | 小 |
| **P1** | Customer 主数据表单缺失 AI 草稿 | `/customers/page.tsx` | 中 |
| **P1** | `/finance/project-receivables` 孤儿页面 | 确认后删除或补入口 | 小 |
| **P1** | `/customers` 无导航入口 | `sidebar.tsx` + `mobile-nav.tsx` | 小 |
| **P2** | 批量合并 UI（客户/机构/订单） | 各列表页 | 中 |
| **P2** | CRM 客户池批量指派/回收 | `/crm/customer-pool/page.tsx` | 中 |
| **P2** | 财务子页补充 sidebar 导航 | `sidebar.tsx` | 小 |
| **P2** | Voice/ASR 组件统一 | 提取通用组件 | 中 |
| **P3** | `organizations/resolve` 在 Project/Order 表单复用 | 相关表单 | 小 |
| **P3** | Ticket fallback plugin | `/projects/[id]/page.tsx` | 小 |
| **P3** | 移动端补充 `/tickets` | `mobile-nav.tsx` | 小 |

---

## 附录：API ↔ UI 对照速查表

### 完全未暴露的 API（无前端调用）

| # | API | 类型 | 应暴露位置 |
|---|-----|------|-----------|
| 1 | `POST /api/orders/merge` | Shortcut | `/orders` 批量操作栏 |
| 2 | `POST /api/projects/[id]/invoice-draft` | Utility | `InvoiceFormDialog` |
| 3 | `POST /api/representatives/quick-create` | Shortcut | `/admin/representatives`（若解封） |
| 4 | `POST /api/crm/interactions/[id]/asr` | Utility | 互动详情页 |
| 5 | `POST /api/crm/checkins/[id]/asr` | Utility | 签到流程页 |

### 入口隐藏过深的页面

| # | 页面 | 当前入口层级 | 建议入口 |
|---|------|-------------|---------|
| 1 | `/finance/invoice-receipt-detail` | Dashboard → 卡片 (2级) | Sidebar 二级菜单 |
| 2 | `/finance/progress-receivables` | Dashboard → 卡片 (2级) | Sidebar 二级菜单 |
| 3 | `/finance/invoice-status` | Dashboard → 卡片 (2级) | Sidebar 二级菜单 / 评估废弃 |
| 4 | `/finance/project-invoices` | Dashboard → 卡片 (2级) | Sidebar 二级菜单 |
| 5 | `/finance/project-receivables` | **无入口** (孤儿) | 补入口或删除 |
| 6 | `/crm/customer-pool` | Dashboard → 卡片 (2级) | Sidebar 二级菜单 |
| 7 | `/crm/my-report` | Dashboard → 卡片 (2级) | Rep Sidebar |
| 8 | `/crm/my-organizations` | Dashboard → 卡片 (2级) | Rep Sidebar |
| 9 | `/customers` | 订单详情深链 (3级+) | 明确废弃或给独立入口 |
| 10 | `/admin/organizations/analytics` | 机构页 → [id]/analytics → back-link (3级) | 机构列表顶部按钮 |

### 快捷组件/API 复用缺失

| # | 能力 | 已复用 | 未复用 |
|---|------|--------|--------|
| 1 | `DraftInputPanel` (AI 草稿) | Project创建、Ticket创建、Order创建 | **Project编辑、Customer创建/编辑、Order编辑、Invoice、CRM Follow-up、CRM Checkin** |
| 2 | `project.smart-fill` fallback | Project创建 | **Project编辑、Ticket创建** |
| 3 | `order.smart-fill` fallback | Order创建 | **Order编辑** |
| 4 | `customer.create` schema | CustomerApplicationDialog | **Customer主数据创建/编辑** |
| 5 | `/api/organizations/resolve` | CustomerApplicationDialog、CustomerEditDialog | **Project表单、Order表单** |
| 6 | `/api/organizations/ai-draft` | Admin机构表单 | **CRM客户申请、Project表单** |
| 7 | Voice/ASR (通用) | DraftInputPanel、CrmVoiceInput、InteractionForm | **Follow-up、Checkin、Project编辑、Customer编辑** |
| 8 | `/api/projects/[id]/invoice-draft` | 无 | **InvoiceFormDialog（传null）** |
