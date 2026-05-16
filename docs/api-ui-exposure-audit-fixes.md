# SciManage API 暴露与 UI 入口修复报告

> 基于 `api-ui-exposure-audit-report.md` 的审查结果实施修复  
> 修复时间：2026-05-16

---

## 修复概览

| 原问题类别 | 修复项数 | 状态 |
|-----------|---------|------|
| 有 API 但 UI 完全未暴露 | 3 项 | ✅ 已修复 |
| API / 页面入口隐藏过深 | 3 项 | ✅ 已修复 |
| 填单快捷 API 未被复用 | 3 项 | ✅ 已修复 |
| 移动端导航缺失 | 1 项 | ✅ 已修复 |
| 其他优化 | 1 项 | ✅ 已修复 |

---

## 一、有 API 但 UI 完全未暴露（已修复 3/5）

### 1.1 ✅ 订单合并 API 已接入前端

**问题**：`POST /api/orders/merge` 后端完整实现，但前端零调用，订单列表无合并入口。

**修复文件**：`src/app/orders/page.tsx`

**修复内容**：
- 新增 `mergeRunning` state 和 `handleBatchMerge` 函数
- 在批量操作浮动栏（Desktop + Mobile）添加「批量合并」按钮
- 合并前预检：拒绝已合并过的订单、要求至少选择 2 条
- 串行调用 `/api/orders/merge`，逐条将 sourceOrder 合并到 targetOrder（第一个选中的订单）
- 支持部分成功提示：成功数 + 失败明细

```tsx
// 批量合并按钮（桌面端）
<Button size="sm" variant="outline" onClick={handleBatchMerge} disabled={mergeRunning}>
  <Merge className="h-3 w-3 mr-1" />批量合并
</Button>
```

### 1.2 ✅ 发票 AI 草稿已激活

**问题**：`POST /api/projects/[id]/invoice-draft` 后端完全闲置，`InvoiceFormDialog` 所有调用点传 `aiDraftUrl={null}`。

**修复文件**：`src/app/orders/[id]/page.tsx`

**修复内容**：
- 订单详情页新建/编辑发票弹窗，当订单已关联项目时，自动传入 `aiDraftUrl`
- `aiDraftUrl={projectLinks.length > 0 ? \`/api/projects/${projectLinks[0].project.id}/invoice-draft\` : null}`
- 如果订单无关联项目，则保持 `null`，不显示 AI 填写按钮

### 1.3 ✅ CRM 签到语音 ASR 已接入

**问题**：`POST /api/crm/checkins/[id]/asr` 后端闲置，签到流程只有 GPS + 照片，无语音录入。

**修复文件**：`src/components/crm/checkin-flow.tsx`

**修复内容**：
- 在签到流程中添加「录音」/「停止录音」按钮
- 使用原生 `MediaRecorder` + `getUserMedia` 录制音频
- 录音完成后上传到 `/api/crm/upload`（checkinId 作为 owner）
- 上传成功后 PATCH checkin 传入 `voiceUrl`
- 自动调用 `/api/crm/checkins/[id]/asr` 进行语音识别
- 识别结果（`transcript`）在签到卡片下方展示为「语音摘要」
- 语音也可作为完成签到的凭证之一（无定位且无照片时，有语音即可提交）
- 组件 unmount 时自动停止录音并释放资源

```tsx
<Button variant={recording ? "destructive" : "outline"}
  onClick={recording ? stopRecording : startRecording}>
  {recording ? <><Square />停止录音</> : <><Mic />录音</>}
</Button>
```

**未修复（保留现状）**：
- `POST /api/representatives/quick-create` — 该 API 本身返回 403 禁用，业务上未启用快捷创建代表
- `POST /api/crm/interactions/[id]/asr` — 已保存互动的二次转写，需求优先级低，暂未接入

---

## 二、API / 页面入口隐藏过深（已修复 3/4）

### 2.1 ✅ Sidebar 补充客户主数据 & 客户公海池入口

**问题**：`/customers` 无主导航入口；`/crm/customer-pool` 只能从 Dashboard 卡片进入。

**修复文件**：`src/components/sidebar.tsx`

**修复内容**：
- 在「运营模块」下新增「客户主数据」入口（`/customers`）
- 在「运营模块」下新增「客户公海池」入口（`/crm/customer-pool`），Representative 角色不可见

```tsx
const ops: NavGroup = {
  title: "运营模块",
  items: [
    { href: "/customers", label: "客户主数据", icon: UserRound },
    { href: "/crm", label: "CRM 管理", icon: HeartHandshake },
  ],
};
if (role !== "REPRESENTATIVE") {
  ops.items.push({ href: "/crm/customer-pool", label: "客户公海池", icon: FishSymbol });
}
```

### 2.2 ✅ MobileNav 补充工单入口

**问题**：`/tickets` 在桌面端 Sidebar 有入口，但在移动端底部导航缺失。

**修复文件**：`src/components/mobile-nav.tsx`

**修复内容**：
- 在移动端底部导航中，「项目」和「CRM」之间新增「工单」入口

```tsx
items.push(
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/tickets", label: "工单", icon: Ticket },  // ← 新增
  { href: "/crm", label: "CRM", icon: HeartHandshake }
);
```

**未修复（评估后保留现状）**：
- `/admin/organizations/analytics` — 入口确实较深（需先进入机构列表 → [id]/analytics → back-link），但修改需要重新设计机构列表页布局，本次未涉及
- 财务子页面（invoice-receipt-detail、progress-receivables 等）— 已通过 Dashboard 卡片提供入口，若全部加入 Sidebar 会导致导航臃肿，保持现状

---

## 三、填单快捷 API 未被复用（已修复 3/6）

### 3.1 ✅ Project 编辑接入 AI 草稿

**问题**：`DraftInputPanel` 仅在 Project 创建中使用，编辑表单完全缺失。

**修复文件**：`src/app/projects/[id]/page.tsx`

**修复内容**：
- 在「编辑项目」弹窗的 `<form>` 内顶部插入 `DraftInputPanel`
- `formKey="project.edit"`，`fallbackPlugin="project.smart-fill"`
- `onApply` 将 AI 返回字段 merge 到 `editForm` state
- 支持字段：项目名称、描述、单位、客户、代表、状态、进度、项目类型、内容、数量、采购来源、品牌、技术支持

### 3.2 ✅ Customer 主数据编辑接入 AI 草稿

**问题**：客户主数据表单无任何智能填单能力。

**修复文件**：`src/app/customers/page.tsx`

**修复内容**：
- 在「编辑客户信息」弹窗的 `<form>` 内顶部插入 `DraftInputPanel`
- `formKey="customer.create"`（无独立 edit schema，字段兼容）
- `onApply` 将字段 merge 到 `editForm`
- 支持字段：客户姓名、客户单位、小程序 ID

### 3.3 ✅ Order 编辑接入 AI 草稿

**问题**：订单编辑表单完全手动，无智能辅助。

**修复文件**：`src/components/orders/order-edit-dialog.tsx`

**修复内容**：
- 在编辑订单 Tabs 上方插入 `DraftInputPanel`
- `formKey="order.create"`（无独立 edit schema，字段大部分兼容）
- `fallbackPlugin="order.smart-fill"`
- `onApply` 支持基本字段直接 merge，以及 `lines` 数组到 `editLines` 的映射转换
- 支持字段：订单标题、描述、分类、客户、买方快照、下单日期、明细项、财务口径、成本等

**未修复（需后续规划）**：
- Invoice 表单 AI 草稿 — `aiDraftUrl` 已激活（见 1.2），但 InvoiceFormDialog 自身的 `handleAiDraft` 仅基于 `projectId` 生成草稿，若从非项目场景（如批量开票）创建发票，AI 草稿仍不可用。需进一步评估是否扩展 AI 草稿能力到订单上下文。
- CRM Follow-up / CRM Checkin 的 `DraftInputPanel` — 需要新建 form schema 和 fallback plugin，工作量较大，本次未涉及。
- `organizations/resolve` 在 Project/Order 表单复用 — 需要修改 `OrganizationSelect` 组件或表单逻辑，影响面较大，本次未涉及。

---

## 四、其他优化

### 4.1 ✅ `/finance/project-receivables` 已评估

**问题**：报告标记为「完全孤儿页面」。

**实际状态**：该页面已是一个重定向组件：
```tsx
export default function ProjectReceivablesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/finance/order-receivables"); }, [router]);
  return null;
}
```
- 保留该页面作为 legacy URL 的兼容重定向，无需额外处理。

---

## 修改文件清单

| # | 文件路径 | 修改类型 | 关联问题 |
|---|---------|---------|---------|
| 1 | `src/components/mobile-nav.tsx` | 新增导航项 | 移动端缺失 `/tickets` |
| 2 | `src/components/sidebar.tsx` | 新增导航项 | `/customers`、`/crm/customer-pool` 无入口 |
| 3 | `src/app/orders/[id]/page.tsx` | 功能激活 | 发票 AI 草稿未启用 |
| 4 | `src/app/orders/page.tsx` | 新增功能 | 订单合并 API 无 UI |
| 5 | `src/app/projects/[id]/page.tsx` | 新增组件 | Project 编辑无 AI 草稿 |
| 6 | `src/app/customers/page.tsx` | 新增组件 | Customer 编辑无 AI 草稿 |
| 7 | `src/components/orders/order-edit-dialog.tsx` | 新增组件 | Order 编辑无 AI 草稿 |
| 8 | `src/components/crm/checkin-flow.tsx` | 新增功能 | 签到无语音/ASR |

---

## 质量验证

| 验证项 | 结果 |
|--------|------|
| `npm run lint` | ✅ 0 error（8 warnings 均为已有代码） |
| `npx tsc --noEmit` | ✅ 通过 |
| `npm run build` | ✅ 通过 |

---

## 仍需后续规划的项

| 优先级 | 问题 | 原因 |
|--------|------|------|
| P2 | `POST /api/crm/interactions/[id]/asr` 无 UI | 需求优先级低，暂无互动详情页语音重录场景 |
| P2 | Invoice 非项目场景的 AI 草稿 | 需扩展 `invoice-draft` 到订单上下文 |
| P2 | CRM Follow-up / Checkin 接入 `DraftInputPanel` | 需新建 form schema + fallback plugin |
| P3 | `organizations/resolve` 在 Project/Order 表单复用 | 需改造 OrganizationSelect 或表单保存逻辑 |
| P3 | `/admin/organizations/analytics` 入口过深 | 需重新设计机构列表页布局 |
