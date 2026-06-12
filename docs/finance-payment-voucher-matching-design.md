# 财务到款凭证 — 发票自动组合匹配方案

> **文档编号**：`DOC-001`
> **模块**：Finance / 财务
> **版本**：v2（评审修订版）
> **状态**：Design Draft（待第二轮评审）
> **创建日期**：2026-06-12
> **最近更新**：2026-06-12
> **作者**：SciManage Dev
> **相关文件**：`src/lib/finance/*`、`src/app/finance/order-receivables/page.tsx`、`prisma/schema.prisma`

### 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-06-12 | 初稿（保留在文末 §14"v1 → v2 变更对照"，作为评审基线） |
| v2 | 2026-06-12 | 按 7 条评审 finding 全面修订：① 引入 `FinanceReceiptAllocation` 作为唯一回款分摊真源，重写 order-receivable / payment-status / receipt CRUD 聚合口径；② 候选筛选改为"机构解析 + 可见 scope 双过滤"，buyerOrganizationId=NULL 历史发票排除；③ 组合算法改为带索引的 meet-in-the-middle / 回溯，保留发票 identity；④ 明确"Phase 1 禁止差额"，confirm API 强校验 `Σ allocation == receipt.amount`；⑤ 新增 `canWriteFinance` helper；⑥ RED 冲红前置校验同时查新表 + 历史单字段 |

---

## 编号说明

本系列设计文档采用编号格式 `DOC-NNN`（NNN 为三位顺序号）。后续新建财务/CRM/订单相关设计文档时请递增此编号并在本文件末尾"相关文档索引"中登记，便于追溯与交叉引用。

| 编号 | 文件 | 主题 | 日期 |
|------|------|------|------|
| DOC-001 | `finance-payment-voucher-matching-design.md` | 财务到款凭证 — 发票自动组合匹配方案 | 2026-06-12 |

---

## 1. 目标

在"应收回款工作台" `/finance/order-receivables` 新增一个入口：用户录入一笔**银行到款凭证**（付款单位 + 金额 + 日期），系统根据单位解析出 Organization，筛选该单位下所有"已开票、未冲红、未核销完毕"的 `ExternalOrderInvoiceRequest`，用组合求和算法找出**金额严格等于凭证金额**的发票组合，供用户确认后一次性完成核销（写入 `FinanceReceipt` + `FinanceReceiptAllocation` 分摊表）。

用户已确认的设计选项：
- 入口位置：`/finance/order-receivables` 加操作按钮
- 匹配粒度：**发票**（`ExternalOrderInvoiceRequest.totalAmount` / `outstanding`）
- 金额容差：**严格相等**（不允许容差）
- 写库语义：**创建回款记录 + 发票级核销（带 allocation 分摊表）**
- 跨订单：**允许跨订单，但不允许跨 buyerOrganizationId**
- 差额处理：**Phase 1 禁止差额**，`Σ allocation == receipt.amount` 必须精确成立

### 1.1 核心语义承诺（v2 新增，指导后续所有章节）

| # | 承诺 | 后果 |
|---|------|------|
| S1 | **回款分摊的唯一真源是 `FinanceReceiptAllocation`** | 订单回款总额、发票已核销额、支付状态、回款流水详情全部从此表聚合；旧的 `FinanceReceipt.orderId` / `externalOrderInvoiceRequestId` 字段在新流程里不再写入，旧数据保留兼容 |
| S2 | **一笔凭证只能核销同一 `buyerOrganizationId` 下的发票** | 候选集天然单机构；不再"回填第一个 order 到 receipt.orderId"的伪关联 |
| S3 | **Phase 1 不允许任何差额** | confirm API 强校验 `Σ allocation == receipt.amount`；向导不提供"手动勾选 + 差额进入部分核销"的入口；无精确命中时只展示诊断和建议组合，写库按钮禁用 |
| S4 | **候选 = 机构解析命中 ∩ 用户可见 scope** | `buyerOrganizationId IS NULL` 的历史发票不进候选；向导明确提示"未绑机构的发票需先在发票工作台补绑" |

这四条承诺一旦改变，需要连同 §5（写库）、§6（模型）、§7（API）、§10（迁移）一起修订。

---

## 2. 用户工作流

```
/finance/order-receivables
   │
   ├─ 顶部新增按钮  [凭证匹配]
   │      │
   │      ▼
   ├─ 向导步骤 1：录入凭证
   │     • 付款单位名称（必填）
   │     • 凭证金额（必填，分位精度）
   │     • 到款日期（默认今天）
   │     • 来源 source（默认 BANK_VOUCHER）
   │     • 备注（可选）
   │     • [开始匹配]
   │
   ├─ 向导步骤 1.5（仅当 org 解析为 candidate / unmatched 时出现）：机构确认
   │     • 展示 resolveOrganization 的候选列表，支持改选或新建 Organization
   │     • 未确认前不允许进入步骤 2
   │
   ├─ 向导步骤 2：匹配结果
   │     • 顶部摘要：候选发票 N 张（已排除未绑机构的历史发票 M 张） / 合计 C 元 / 凭证金额 T 元
   │     • 命中时：
   │         - 组合卡片（≤5 张），每张列出发票编号 / 金额 / 所属订单 / 开票日期
   │         - 选中的卡片高亮，下方 [确认核销] 按钮可用
   │     • 无精确命中时：
   │         - 显示"未找到精确组合"
   │         - 分别给出"最接近且不超过"和"最小超出"两个参考组合（只读）
   │         - [确认核销] 按钮禁用；文案提示"请调整凭证金额或先在发票工作台处理异常发票"
   │     • 不提供"手动勾选 + 差额核销"入口（v2：Phase 1 禁止差额，对应 §1.1 S3）
   │
   └─ 向导步骤 3：完成
         • 显示生成的 FinanceReceipt 编号
         • 显示每张发票的已核销 / 剩余金额（按 allocation 聚合）
         • 若涉及多订单：显示"跨订单核销：订单 A（x 元）+ 订单 B（y 元）"
         • [查看回款流水] / [继续匹配]
```

---

## 3. 匹配算法

### 3.1 候选发票筛选（v2 重写，对应 finding #5）

输入：`payerName: string`、`targetAmount: number`

1. 调用 `resolveOrganization(payerName)` 解析机构：
   - `status = "exact"` → 拿到 `organizationId`，继续
   - `status = "candidate"` → 把候选列表回传前端，让用户先选一个机构（步骤 1.5）
   - `status = "unmatched"` → 返回 `ORG_UNRESOLVED`，前端阻断并提示
2. 从 DB 查询候选发票（Prisma 伪代码）：
   ```ts
   prisma.externalOrderInvoiceRequest.findMany({
     where: {
       AND: [
         { buyerOrganizationId: orgId },          // v2: 必须非空且精确命中
         { status: "ISSUED" },
         { adjustmentsAsOriginal: { none: { kind: "RED" } } },
         { totalAmount: { gt: 0 } },
         getFinanceCustomerScopeWhere(session),   // v2: 叠加可见 scope
       ],
     },
   })
   ```
   - `buyerOrganizationId IS NULL` 的历史发票**明确不进候选**，由 API 返回 `orphanInvoiceCount` 给前端显示"未绑机构发票 M 张"提示
3. 对每张发票计算**剩余待核销金额**（v2：改用 allocation 聚合，而不是 1-to-1 字段）：
   ```ts
   allocated = prisma.financeReceiptAllocation.groupBy({
     by: ["invoiceId"],
     where: { invoiceId: { in: candidateIds } },
     _sum: { amount: true },
   })
   outstanding = totalAmount − (allocated[invoiceId] ?? 0)
   ```
   只保留 `outstanding > 0` 的发票；用 `outstanding` 替代 `totalAmount` 参与组合。
4. 若 `Σ outstanding < targetAmount`：直接返回 `SUM_SHORTFALL`，附上全集组合与差额。

### 3.2 组合求和（v2 重写，对应 finding #4）

问题：给定带 identity 的发票集合 `{ inv_i, outstanding_i }` 和目标 `T`，枚举所有子集使和严格等于 `T`。

**v1 的缺陷**：
- 一维 `dp[s]` 不能支撑 `if !dp[remain]` 剪枝（它表示"用全部元素能否凑出"，不表示"从下标 i 之后能否凑出"）
- `a[i] == a[i-1]` 跳过分支会合并两张金额相同但 identity 不同的发票，破坏 FIFO 并漏掉合法组合

**v2 算法**：带索引回溯 + suffix DP 可行性剪枝，完整保留发票 identity。

```
输入：items = [{ id, amount }] (按 amount 升序), target T (整数，单位：分)
输出：所有 Σ amount == T 的 id 子集（上限 MAX_RESULTS = 20）

1. 金额全部 × 100 转整数分，避免浮点比较
2. suffixSum[i] = Σ items[k].amount for k in [i, n)
3. suffixPossible[i][s] = 用 items[i..n) 能否凑出 s
   构造：从 i = n-1 递减到 0，对每个 s ∈ [0, T]：
     suffixPossible[i][s] = suffixPossible[i+1][s]
                          || (s >= items[i].amount && suffixPossible[i+1][s - items[i].amount])
   边界：suffixPossible[n][0] = true, 其余 false
   内存：O(n·T)，T 在 ≤ 10^7 分（10 万元）范围可接受；T 更大时退化为无剪枝回溯
4. 回溯（保留 identity）：
   function dfs(i, remain, path):
     if remain == 0: emit(path); return
     if i == n or results.length >= MAX_RESULTS: return
     if suffixSum[i] < remain: return
     if !suffixPossible[i][remain]: return          // 强剪枝
     // 不选 items[i]
     dfs(i + 1, remain, path)
     // 选 items[i]（永远进入，不按金额去重，因为 identity 不同）
     dfs(i + 1, remain - items[i].amount, path + [items[i].id])

5. 去重（仅当同一张发票 ID 在输入里出现多次时才做）：在入口前对 items 按 id 去重即可
```

**复杂度**：
- 时间：剪枝后通常远小于 O(2^n)；n ≤ 30、T ≤ 10^7 分时 < 100 ms
- 空间：O(n·T) 的 suffixPossible；n=30、T=10^7 时 ~300 MB，超限则降级为无 DP 的纯回溯

**降级路径**（`n > 40` 或 `T > 10^7` 分）：
- 只计算"最接近且不超过"和"最小超出"两个最近邻组合（用一维 DP + 单次回溯可得）
- 不枚举所有命中组合；API 响应里 `degraded: true`

### 3.3 组合排序与呈现

- 按发票张数升序（越少越好）
- 张数相同时，优先包含开票日期更久的发票（FIFO 核销）
- 最多返回 5 个组合给前端展示；其余折叠为"更多 N 个组合"

### 3.4 无精确命中时的诊断

- 若 `Σ outstanding < T`：返回 `SUM_SHORTFALL`，附全集组合与差额 Δ
- 若 `Σ outstanding ≥ T` 但无精确组合：返回 `NO_SUBSET_EQUALS`，附：
  - **最接近且不超过 T**：用 suffixPossible 找 `max s ≤ T where suffixPossible[0][s]`，回溯给出 1 个组合
  - **最小超出 T**：在补集 `sum(items) − T` 上做同样的最近邻查找
- 前端在两种情况下都禁用 [确认核销]（对应 §1.1 S3）

---

## 4. 现有口径重写清单（v2 新增章节，对应 finding #1 #2）

> 这是 v2 最大的工程面。v1 只设计了"新接口 + 新表"，漏掉了所有按 `FinanceReceipt.orderId` / `externalOrderInvoiceRequestId` 聚合的存量代码。

### 4.1 聚合真源对照表

| 维度 | v1 / 现状真源 | v2 真源 |
|------|---------------|---------|
| 订单回款总额 | `Σ FinanceReceipt.amount where orderId = X` | `Σ FinanceReceiptAllocation.amount where invoice.orderId = X`（新 + 旧 1-to-1 兼容） |
| 发票已核销额 | `Σ FinanceReceipt.amount where externalOrderInvoiceRequestId = I` | `Σ FinanceReceiptAllocation.amount where invoiceId = I`（新 + 旧 1-to-1 兼容） |
| 支付状态（`UNPAID`/`PARTIAL`/`PAID`） | 基于上述两项 | 同上 |

### 4.2 受影响的代码点

| 文件 | 现状 | v2 改造 |
|------|------|---------|
| `src/lib/finance/order-receivables.ts:145` `getOrderReceiptTotals` | 按 `FinanceReceipt.orderId` 聚合 | 改为按 `FinanceReceiptAllocation.invoice.orderId` 聚合，并兼容历史 `FinanceReceipt.orderId` 字段（`UNION` 去重） |
| `src/lib/finance/payment-status.ts:31` `computeInvoicePaymentStatus` | 按 `projectInvoiceId` / `externalOrderInvoiceRequestId` 单字段求和 | 改为同时累加新表 + 旧字段 |
| `src/app/api/finance/order-receivables/route.ts:56-81` | 依赖 `getOrderReceiptTotals` | 间接受影响；上游改造后无需改动 |
| `src/app/api/finance/receipts/[id]/route.ts:32,167,226` GET/PATCH/DELETE | 只读/改/删单字段 | GET 返回时附带 `allocations[]`；PATCH 拒绝修改已含 allocation 的 receipt；DELETE 同时级联删除 allocation 并写审计 |
| `src/app/api/finance/order-invoices/[id]/red/route.ts:15` | 不校验回款占用 | 新增前置校验（见 §8.3） |
| `src/components/finance/receipt-form-dialog.tsx` | 表单里有 `externalOrderInvoiceRequestId` 字段 | 新增 `BANK_VOUCHER` 分支：隐藏 1-to-1 字段，改展示 allocation 列表 |
| `src/app/finance/invoice-receipt-detail/page.tsx` | 单行展示 receipt | 加"核销发票数"列，点击展开 allocation 表 |

### 4.3 兼容策略

- **读路径**：所有聚合函数统一封装为 `sumReceiptsForOrder(orderId)` / `sumReceiptsForInvoice(invoiceId)`，内部 `UNION` 新旧两条路径（旧：`FinanceReceipt.orderId` 或 `externalOrderInvoiceRequestId` 不为 NULL；新：`FinanceReceiptAllocation`）
- **写路径**：新流程只写 allocation 表，不写 1-to-1 字段；手工录入 receipt 的旧对话框仍写 1-to-1 字段（向后兼容，未来逐步收敛）
- **迁移**：不做一次性回填；旧字段保留 NULL 或历史值，由读路径 UNION 兜底

---

## 5. 写库语义（v2 重写）

确认匹配后，在**单个 Prisma `$transaction`** 内：

1. `create FinanceReceipt`
   - `amount = targetAmount`
   - `receivedAt = voucherDate`
   - `source = "BANK_VOUCHER"`（新增枚举值，与 `BANK` 区分）
   - `remark = "凭证匹配：付款单位=<payer>, 命中 <k> 张发票"`
   - `orderId = NULL`、`externalOrderInvoiceRequestId = NULL`（v2：不再做伪关联）
2. 对每张被选中的发票 `inv_i`：
   - `allocatedAmount_i = outstanding_i`（v2 禁止差额 → 组合命中时 outstanding 必等于组合内的分摊）
   - 创建 `FinanceReceiptAllocation`：`{ receiptId, invoiceId, orderId: inv_i.orderId, amount: allocatedAmount_i }`
3. 强校验：`Σ allocatedAmount_i == receipt.amount`；不等则事务回滚并返回 400（对应 §1.1 S3）

事务失败返回 500 + 明细；409 表示并发超核销冲突。

---

## 6. 数据模型变更（v2 重写）

### 6.1 新增 `FinanceReceiptAllocation`（取代 v1 的 `FinanceReceiptInvoice`）

```prisma
model FinanceReceiptAllocation {
  id              String    @id @default(cuid())
  receiptId       String
  receipt         FinanceReceipt @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  invoiceId       String    // ExternalOrderInvoiceRequest.id
  invoice         ExternalOrderInvoiceRequest @relation(fields: [invoiceId], references: [id])
  orderId         String?   // 冗余便于按订单直接聚合；与 invoice.orderId 应一致
  order           Order?    @relation(fields: [orderId], references: [id])
  amount          Float     // 本次核销分摊金额（单位与 FinanceReceipt.amount 一致）
  createdAt       DateTime  @default(now())
  createdByUserId String?
  @@unique([receiptId, invoiceId])
  @@index([invoiceId])
  @@index([orderId])
}
```

设计取舍：
- `orderId` 冗余：违反 3NF，但让"订单回款总额"查询可以单表聚合，不必 join invoice。写入时强制校验 `allocation.orderId == invoice.orderId`
- `onDelete: Cascade`：删除 receipt 时自动清掉 allocation（审计由 `FinanceReceiptDeletionLog` 兜底）

### 6.2 `FinanceReceipt` 侧

- 新增反向关系：`allocations: FinanceReceiptAllocation[]`
- `source` 枚举增加 `BANK_VOUCHER`（现有 `MANUAL | BANK | PINGOODMICE_ORDER | OTHER`）
- v2 约定：当 `source = BANK_VOUCHER` 时，`orderId` / `externalOrderInvoiceRequestId` / `projectInvoiceId` 三个 1-to-1 字段**必须为 NULL**，由 allocation 表承载

### 6.3 `ExternalOrderInvoiceRequest` 侧

- 新增反向关系：`allocations: FinanceReceiptAllocation[]`
- 不新增冗余字段；outstanding 通过聚合计算（见 §4.1）

### 6.4 迁移

`npx prisma migrate dev --name add_finance_receipt_allocation`；`db push` 用于开发期。

---

## 7. API 设计

### 7.1 `POST /api/finance/payment-vouchers/match`（v2 扩展响应）

只做匹配计算，**不写库**。

请求：
```json
{
  "payerName": "某某大学",
  "amount": 125800,
  "receivedAt": "2026-06-10",
  "organizationId": "可选，已知时直传跳过解析"
}
```

响应（命中）：
```json
{
  "status": "MATCHED",
  "organization": { "id": "...", "canonicalName": "...", "resolveStatus": "exact" },
  "candidateInvoices": [
    { "id": "...", "invoiceNo": "...", "totalAmount": 50000, "outstanding": 50000, "issuedAt": "...", "orderId": "..." }
  ],
  "orphanInvoiceCount": 3,
  "candidateTotal": 345000,
  "combinations": [
    { "invoiceIds": ["..."], "amounts": [50000, 45000, 30800], "sum": 125800, "count": 3, "crossOrder": true, "orderBreakdown": [{ "orderId": "...", "sum": 80000 }, { "orderId": "...", "sum": 45800 }] }
  ],
  "degraded": false,
  "truncated": false,
  "totalCombinations": 4
}
```

响应（未命中）：
```json
{
  "status": "NO_EXACT_MATCH",
  "reason": "SUM_SHORTFALL | NO_SUBSET_EQUALS",
  "organization": {},
  "candidateInvoices": [],
  "orphanInvoiceCount": 0,
  "candidateTotal": 0,
  "nearestBelow": { "sum": 124500, "delta": -1300, "invoiceIds": [] },
  "nearestAbove": { "sum": 127000, "delta": 1200, "invoiceIds": [] },
  "degraded": false
}
```

响应（机构未识别）：
```json
{ "status": "ORG_UNRESOLVED", "candidates": [], "reason": "candidate | unmatched" }
```

### 7.2 `POST /api/finance/payment-vouchers/confirm`（v2 强校验）

写库。

请求：
```json
{
  "payerName": "某某大学",
  "amount": 125800,
  "receivedAt": "2026-06-10",
  "source": "BANK_VOUCHER",
  "organizationId": "org_xxx",
  "selectedInvoiceIds": ["inv_a", "inv_b", "inv_c"],
  "remark": "..."
}
```

后端：
- **权限**：`canWriteFinance(session.role)`（v2 新增 helper，仅 `ADMIN | USER`；见 §8）
- **校验**：
  - 每张发票仍 ISSUED 且未冲红
  - 每张发票的 `buyerOrganizationId == request.organizationId`（防御跨机构）
  - `outstanding_i > 0`（重算时刻）
  - `Σ outstanding_i == receipt.amount`（**强校验，对应 §1.1 S3**）
- 事务内创建 `FinanceReceipt` + N 条 `FinanceReceiptAllocation`
- 并发超核销时返回 409

响应：
```json
{
  "receipt": { "id": "...", "amount": 125800, "receivedAt": "2026-06-10", "source": "BANK_VOUCHER" },
  "allocations": [
    { "invoiceId": "...", "orderId": "...", "amount": 50000, "newOutstanding": 0 }
  ],
  "crossOrder": true,
  "orderBreakdown": [ { "orderId": "...", "sum": 80000 }, { "orderId": "...", "sum": 45800 } ]
}
```

---

## 8. 权限（v2 重写，对应 finding #6）

### 8.1 新增 `canWriteFinance` helper

位置：`src/lib/finance/permissions.ts`

```ts
export function canWriteFinance(role: Role): boolean {
  return role === "ADMIN" || role === "USER"
}
```

明确**不包含** `REGIONAL_MANAGER`（现有 `canReadFinance` 包含 REGIONAL_MANAGER，v1 的措辞"复用 canReadFinance"会被误实现为可读即可写）。

### 8.2 路由级校验

- `POST /api/finance/payment-vouchers/match`：`canReadFinance`（REGIONAL_MANAGER 可查看自己 scope 内的候选）
- `POST /api/finance/payment-vouchers/confirm`：`canWriteFinance`
- 候选集叠加 `getFinanceCustomerScopeWhere(session)` 做数据范围隔离（v2：在 §3.1 的 Prisma where 中直接传入）

### 8.3 审计

- confirm API 写 `FinanceReceipt.createdByUserId = session.user.id`
- 每条 `FinanceReceiptAllocation.createdByUserId = session.user.id`

---

## 9. 冲红 / 编辑 / 删除的关联影响（v2 新增，对应 finding #7）

### 9.1 RED 冲红前置校验

修改 `src/app/api/finance/order-invoices/[id]/red/route.ts`：

```ts
const occupied = await prisma.financeReceiptAllocation.count({
  where: { invoiceId: params.id },
})
const legacyOccupied = await prisma.financeReceipt.count({
  where: { externalOrderInvoiceRequestId: params.id },
})
if (occupied > 0 || legacyOccupied > 0) {
  return NextResponse.json(
    { error: "INVOICE_OCCUPIED", message: "该发票已有回款核销，请先撤销核销再冲红" },
    { status: 409 }
  )
}
```

v2 同时查新表和历史 1-to-1 字段，避免"双标"。

### 9.2 Receipt DELETE

修改 `src/app/api/finance/receipts/[id]/route.ts`：
- 已有软删除逻辑保留
- `onDelete: Cascade` 会自动清掉 `FinanceReceiptAllocation`；写 `FinanceReceiptDeletionLog` 时附带 `allocationSnapshot`（JSON）

### 9.3 Receipt PATCH

- 禁止修改含 allocation 的 receipt 的 `amount`（会导致分摊不等）
- 允许修改 `remark`、`receivedAt`（审计记录）

---

## 10. UI 改动清单（v2 扩展，对应 finding #2）

| 文件 | 改动 |
|------|------|
| `src/app/finance/order-receivables/page.tsx` | 顶部增加"凭证匹配"按钮（仅在 `canWriteFinance` 时显示） |
| 新建 `src/components/finance/payment-voucher-wizard.tsx` | 三步向导（录入 / 机构确认 / 结果 / 完成），用 shadcn `Dialog` + `Tabs` |
| 新建 `src/components/finance/combination-card.tsx` | 单个组合的展示卡片（radio 选择），展示 `orderBreakdown` |
| 新建 `src/components/finance/invoice-picker-table.tsx` | 候选发票表（**只读**，不提供手动勾选） |
| `src/components/finance/receipt-form-dialog.tsx` | `source = BANK_VOUCHER` 分支隐藏 1-to-1 字段，改展示 allocation 列表 |
| `src/app/finance/invoice-receipt-detail/page.tsx` | 列表新增"核销发票数"列，点击展开 allocation 表 |
| `src/lib/finance/order-receivables.ts` | 聚合函数改为 UNION 新旧路径（见 §4.2） |
| `src/lib/finance/payment-status.ts` | `computeInvoicePaymentStatus` 同上 |
| `src/app/api/finance/order-invoices/[id]/red/route.ts` | 新增占用校验（见 §9.1） |
| `src/app/api/finance/receipts/[id]/route.ts` | GET 返回 `allocations[]`；PATCH 拒绝含 allocation 的 amount 修改；DELETE 同时写 allocation 快照 |

---

## 11. 风险与缓解（v2 扩展）

| 风险 | 缓解 |
|------|------|
| 候选发票数 n 较大时组合爆炸 | `MAX_RESULTS=20` + suffixPossible 强剪枝；n>40 或 T>10^7 分时降级为只返回最近邻 |
| 金额用 Float 导致精度问题 | 算法内部全部乘 100 转整数（分），DB 层仍用 Float（与现有保持一致） |
| 并发：两次匹配选中同一张发票 | confirm 接口在事务内重算 `outstanding` 并校验 `Σ == receipt.amount`，冲突返回 409 |
| 机构解析误命中 | 步骤 1.5 强制用户确认 canonicalName；支持改选 |
| RED 冲红后仍有核销残留 | v2：冲红前置校验同时查新表 + 历史 1-to-1 字段 |
| 已有 `FinanceReceipt.externalOrderInvoiceRequestId` 历史数据 | v2：所有聚合函数 UNION 新旧两条路径 |
| v1 的 `FinanceReceipt.orderId` 回填导致跨订单回款错配 | v2：不再回填；改为按 allocation 聚合（见 §4） |
| 跨订单核销后，订单维度的回款统计出现"一笔凭证计入多订单" | 这正是 v2 的预期语义；UI 在向导步骤 3 明确展示 `orderBreakdown` 让用户核对 |
| 聚合口径重写引入回归 bug | Phase 1 落地时补一套 smoke：对 5 个典型 fixture（单订单 / 跨订单 / 历史 1-to-1 / RED 冲红 / 部分核销）断言 `sumReceiptsForOrder` / `sumReceiptsForInvoice` 的输出 |

---

## 12. 分阶段落地建议（v2 调整）

- **Phase 1**（本次）
  - 向导 + 算法 + `FinanceReceiptAllocation` 表 + 两个 API
  - 重写 §4.2 列出的 6 个聚合点
  - 冲红 / DELETE / PATCH 的关联改造
  - 入口挂在 `/finance/order-receivables`
  - smoke fixture 覆盖 5 类典型场景
- **Phase 2**
  - 在 `/finance/invoice-receipt-detail` 增加"按凭证筛选"视图；导出匹配报告
  - 逐步收敛手工录入 receipt 对话框，引导改用 allocation
- **Phase 3**
  - 批量导入银行流水（Excel / CSV），逐行自动匹配 + 人工复核队列
  - 考虑放开差额转 `FinanceAdvance`（Phase 1 明确禁止）

---

## 13. 不在范围内（v2 更新）

- **不引入任何差额语义**：不允许凭证金额与分摊和不等的情况落库；差额转预收（`FinanceAdvance`）推迟到 Phase 2 评估
- **不做预付款 / 预收款自动对冲**（已有 `FinanceAdvance` 独立处理）
- **不回填历史 `FinanceReceipt.orderId`**：通过 UNION 读路径兼容
- **不改造 `FinanceAdvance` 的核销链路**：allocation 表只服务于凭证匹配，advance settlement 保持原样
- **不允许 `buyerOrganizationId IS NULL` 的发票进入候选**：先由用户在发票工作台补绑机构

---

## 14. v1 → v2 变更对照（保留供评审参考）

| 章节 | v1 决策 | v2 决策 | 触发 finding |
|------|---------|---------|--------------|
| §1.1 核心承诺 | 无 | 新增 4 条语义承诺 | #1 #3 |
| §2 工作流 | 提供"手动勾选 + 部分核销" | 禁用，仅精确命中可确认 | #3 |
| §3.1 候选筛选 | `buyerOrganizationId = orgId` | 同 + 可见 scope 叠加 + 排除 NULL | #5 |
| §3.2 算法 | 一维 DP + 值去重回溯 | 带索引回溯 + suffixPossible + 保留 identity | #4 |
| §4（旧）写库 | `FinanceReceiptInvoice` 1:N；receipt.orderId 回填第一个 order | 删除 §4，改为 §5 + §4 聚合口径重写 | #1 #2 |
| §5（旧）模型 | `FinanceReceiptInvoice` | `FinanceReceiptAllocation`（带 orderId 冗余） | #1 |
| §6 API | confirm 宽松校验 | 强校验 `Σ allocation == receipt.amount` | #3 |
| §7 权限 | "复用 canReadFinance" | 新增 `canWriteFinance` helper | #6 |
| §8（旧）UI | 6 个文件 | 10 个文件（含聚合改造） | #2 |
| §9 冲红 | 仅查新表 | 同时查新表 + 历史 1-to-1 | #7 |

---

## 15. 评审检查清单（v2）

- [ ] `FinanceReceiptAllocation` 命名与 Prisma 风格一致
- [ ] 算法对 n>40 的降级路径已在 match API 中明确返回 `degraded: true`
- [ ] confirm API 在事务内重算 `outstanding`（避免脏读）
- [ ] 冲红 API 同时查新表 + 历史 1-to-1
- [ ] `BANK_VOUCHER` 在 `receipts` 路由的 source 白名单中登记
- [ ] `canWriteFinance` 单元测试覆盖 `ADMIN / USER` 允许、`REGIONAL_MANAGER / REPRESENTATIVE` 拒绝
- [ ] 聚合函数 `sumReceiptsForOrder` / `sumReceiptsForInvoice` 有 5 类 fixture 断言
- [ ] 向导步骤 1.5 在 org 解析为 candidate / unmatched 时阻断
- [ ] 金额内部统一使用整数"分"参与 DP
- [ ] `BANK_VOUCHER` 类型的 receipt 详情页展示 allocation 列表而非 1-to-1 字段
- [ ] 跨订单核销在向导步骤 3 明确展示 `orderBreakdown`，用户可核对

---

## 相关文档索引

| 编号 | 文件 | 主题 |
|------|------|------|
| DOC-001 | `docs/finance-payment-voucher-matching-design.md`（本文件） | 财务到款凭证 — 发票自动组合匹配方案 |
