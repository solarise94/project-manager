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
| v2.1 | 2026-06-12 | 第二轮评审修补：① 明确 Phase 1 仅支持 `orderId != NULL` 且 `orderCoverage` 为空的单经济订单发票，排除 `OrderInvoiceCoverage` 场景；② 修正候选 scope 伪代码，改为先求 customer scope 再 AND 到 invoice relation where；③ 明确 `FinanceReceipt` 为软删除，allocation 聚合必须统一过滤 `receipt.deleted = false` |
| v2.2 | 2026-06-12 | 按代码库盘点收敛方案：① 不新增 `BANK_VOUCHER`，复用 `FinanceReceipt.source="BANK"`，以 `allocations.length > 0` 识别凭证匹配回款；② 删除独立 confirm API，改为扩展现有 `POST /api/finance/receipts` 支持 `allocations[]` 分支；③ match API 只接受 `organizationId`，机构解析改由前端复用现有 `/api/organizations/resolve` + `OrganizationSelect`；④ UI 不拆 `combination-card.tsx` / `invoice-picker-table.tsx`，统一内联到 wizard 并复用现有 `FinanceDataTable` / `MoneyText`；⑤ 聚合改造直接落在现有 `getOrderReceiptTotals` / `getInvoicesForOrder` / `payment-status`，不再新增同义 wrapper/helper 名称 |

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
| S3 | **Phase 1 不允许任何差额** | `POST /api/finance/receipts` 的 allocation 分支强校验 `Σ allocation == receipt.amount`；向导不提供"手动勾选 + 差额进入部分核销"的入口；无精确命中时只展示诊断和建议组合，写库按钮禁用 |
| S4 | **候选 = 机构解析命中 ∩ 用户可见 scope** | `buyerOrganizationId IS NULL` 的历史发票不进候选；向导明确提示"未绑机构的发票需先在发票工作台补绑" |
| S5 | **Phase 1 只支持单经济订单锚点发票** | 候选发票必须满足 `orderId != NULL` 且 `orderCoverage` 为空；使用 `OrderInvoiceCoverage` 覆盖多个订单的发票本期不参与自动凭证匹配 |
| S6 | **allocation 聚合只统计未软删除 receipt** | `FinanceReceipt` DELETE 只是 `deleted=true`；所有 outstanding / payment-status / order totals / RED occupation 都必须显式过滤 `receipt.deleted = false` |

这六条承诺一旦改变，需要连同 §5（写库）、§6（模型）、§7（API）、§10（UI/接入）一起修订。

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
   │     • 来源 source 固定写 `BANK`（不新增枚举）
   │     • 备注（可选）
   │     • [解析机构并开始匹配]
   │
   ├─ 向导步骤 1.5（仅当 `/api/organizations/resolve` 返回 candidate / unmatched 时出现）：机构确认
   │     • 复用现有 `OrganizationSelect` / customer-match 类交互，支持改选或新建 Organization
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

输入：`organizationId: string`、`targetAmount: number`

1. 前端先调用现有 `/api/organizations/resolve`，拿到 `organizationId` 后再请求 match API；因此 match API 本身**不处理**机构解析分支。
2. 先求当前用户的 customer scope，再映射到 invoice where：
   ```ts
   const customerScope = await getFinanceCustomerScopeWhere(session.user.id, session.user.role)
   const scopedCustomerIds = customerScope?.id.in ?? null
   ```
3. 从 DB 查询候选发票（Prisma 伪代码）：
   ```ts
   prisma.externalOrderInvoiceRequest.findMany({
     where: {
       AND: [
         { buyerOrganizationId: orgId },          // v2: 必须非空且精确命中
          { status: "ISSUED" },
          { adjustmentsAsOriginal: { none: { kind: "RED" } } }, // REISSUE 不排除；只有 RED 表示原发票失效
          { totalAmount: { gt: 0 } },
         { orderId: { not: null } },              // Phase 1: 必须存在 direct order anchor
         { orderCoverage: { none: {} } },         // Phase 1: 排除 multi-order coverage invoice
         scopedCustomerIds
           ? {
               OR: [
                 { order: { customerId: { in: scopedCustomerIds } } },
                 { externalOrder: { customerId: { in: scopedCustomerIds } } },
               ],
             }
           : {},
       ],
     },
   })
   ```
   - `buyerOrganizationId IS NULL` 的历史发票**明确不进候选**，由 API 返回 `orphanInvoiceCount` 给前端显示"未绑机构发票 M 张"提示
   - `orderCoverage` 非空的发票**明确不进候选**，由 API 返回 `excludedCoveredInvoiceCount` 给前端显示"多订单覆盖发票需人工处理"提示
4. 对每张发票计算**剩余待核销金额**（v2：改用 allocation 聚合，而不是 1-to-1 字段）：
   ```ts
   allocated = prisma.financeReceiptAllocation.groupBy({
     by: ["invoiceId"],
     where: {
       invoiceId: { in: candidateIds },
       receipt: { deleted: false },
     },
     _sum: { amount: true },
   })
   outstanding = totalAmount − (allocated[invoiceId] ?? 0)
   ```
   只保留 `outstanding > 0` 的发票；用 `outstanding` 替代 `totalAmount` 参与组合。
5. 若 `Σ outstanding < targetAmount`：直接返回 `SUM_SHORTFALL`，附上全集金额与差额。

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
   约定：当 `s - items[i].amount < 0` 时第二项视为 `false`
   边界：suffixPossible[n][0] = true, 其余 false
   内存：O(n·T)，`T <= 10^7` 分时二维布尔表仍在可接受范围；若 `T > 10^7` 或按环境评估内存将超限，则不构造 suffixPossible，直接走降级路径
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

**降级路径**（`n > 40` 或 `T > 10^7` 分，或预估 `O(n·T)` 内存超限）：
- 只计算"最接近且不超过"和"最小超出"两个最近邻组合（用一维 DP + 单次回溯可得）
- 不枚举所有命中组合；API 响应里 `degraded: true`

### 3.3 组合排序与呈现

- 按发票张数升序（越少越好）
- 张数相同时，优先包含开票日期更久的发票（FIFO 核销）
- 最多返回 5 个组合给前端展示；其余折叠为"更多 N 个组合"

### 3.4 无精确命中时的诊断

- 若 `Σ outstanding < T`：返回 `SUM_SHORTFALL`，附全集金额与差额 Δ
- 若 `Σ outstanding ≥ T` 但无精确组合：返回 `NO_SUBSET_EQUALS`，附：
  - **最接近且不超过 T**：返回 `{ sum, delta, count }`
  - **最小超出 T**：返回 `{ sum, delta, count }`
- 前端在两种情况下都禁用 [确认核销]（对应 §1.1 S3）

---

## 4. 现有口径重写清单（v2 新增章节，对应 finding #1 #2）

> 这是 v2 最大的工程面。v1 只设计了"新接口 + 新表"，漏掉了所有按 `FinanceReceipt.orderId` / `externalOrderInvoiceRequestId` 聚合的存量代码。

### 4.1 聚合真源对照表

| 维度 | v1 / 现状真源 | v2 真源 |
|------|---------------|---------|
| 订单回款总额 | `Σ FinanceReceipt.amount where orderId = X` | `Σ FinanceReceiptAllocation.amount where allocation.orderId = X and receipt.deleted = false`（新 + 旧 1-to-1 兼容） |
| 发票已核销额 | `Σ FinanceReceipt.amount where externalOrderInvoiceRequestId = I` | `Σ FinanceReceiptAllocation.amount where invoiceId = I`（新 + 旧 1-to-1 兼容） |
| 支付状态（`UNPAID`/`PARTIAL`/`PAID`） | 基于上述两项 | 同上 |

### 4.2 受影响的代码点

| 文件 | 现状 | v2 改造 |
|------|------|---------|
| `src/lib/finance/order-receivables.ts:145` `getOrderReceiptTotals` | 按 `FinanceReceipt.orderId` 聚合 | 直接改为同时聚合 `FinanceReceiptAllocation.orderId` + 历史 `FinanceReceipt.orderId`，并过滤 `receipt.deleted = false` |
| `src/lib/finance/payment-status.ts:31` `computeInvoicePaymentStatus` | 按 `projectInvoiceId` / `externalOrderInvoiceRequestId` 单字段求和 | 改为同时累加新表 + 旧字段 |
| `src/app/api/finance/order-receivables/route.ts:56-81` | 依赖 `getOrderReceiptTotals` | 间接受影响；上游改造后无需改动 |
| `src/app/api/finance/receipts/[id]/route.ts:32,167,226` GET/PATCH/DELETE | 只读/改/删单字段 | GET 返回时附带 `allocations[]`；PATCH 拒绝修改已含 allocation 的 receipt；DELETE 保持软删除，并写 allocation 快照供审计 |
| `src/app/api/finance/order-invoices/[id]/red/route.ts:15` | 不校验回款占用 | 新增前置校验（见 §8.3） |
| `src/app/api/finance/receipts/route.ts:162` POST | 仅支持 `orderId` 1-to-1 创建 receipt，且当前 `orderId` 硬性必填 | 扩展为支持可选 `allocations[]`；有 allocation 时拒绝 `orderId` / `externalOrderInvoiceRequestId`，并把 `orderId` 校验改为条件必填 |
| `src/components/finance/receipt-form-dialog.tsx` | 表单里有 `externalOrderInvoiceRequestId` 字段 | 当 receipt 含 `allocations[]` 时隐藏 1-to-1 字段，改展示 allocation 列表 |
| `src/app/finance/invoice-receipt-detail/page.tsx` | 单行展示 receipt | 加"核销发票数"列，点击展开 allocation 表；判断条件为 `allocations.length > 0` 而不是新 source 枚举 |

### 4.3 兼容策略

- **读路径**：不新增同义 wrapper；直接改现有 `getOrderReceiptTotals`、`getInvoicesForOrder`、`computeInvoicePaymentStatus` 的内部实现，统一兼容新 allocation 路径与旧 1-to-1 路径，且**都显式过滤 `deleted = false`**
- **写路径**：新流程只写 allocation 表，不写 1-to-1 字段；手工录入 receipt 的旧对话框仍写 1-to-1 字段（向后兼容，未来逐步收敛）
- **迁移**：不做一次性回填；旧字段保留 NULL 或历史值，由读路径 UNION 兜底

---

## 5. 写库语义（v2 重写）

确认匹配后，复用现有 `POST /api/finance/receipts`，在其 `allocations[]` 分支里用**单个 Prisma `$transaction`** 完成：

1. `create FinanceReceipt`
   - `amount = targetAmount`
   - `receivedAt = voucherDate`
   - `source = "BANK"`（复用现有枚举，不新增 `BANK_VOUCHER`）
   - `remark = "凭证匹配：付款单位=<payer>, 命中 <k> 张发票"`
   - `createdById = session.user.id`
   - `orderId = NULL`、`externalOrderInvoiceRequestId = NULL`（v2：不再做伪关联）
2. 对每张被选中的发票 `inv_i`：
   - `allocatedAmount_i = outstanding_i`（v2 禁止差额 → 组合命中时 outstanding 必等于组合内的分摊）
   - 创建 `FinanceReceiptAllocation`：`{ receiptId, invoiceId, orderId: inv_i.orderId, amount: allocatedAmount_i, createdById: session.user.id }`
   - Phase 1 前置校验：`inv_i.orderId != NULL && inv_i.orderCoverage.length === 0`，否则返回 400 `INVOICE_NOT_SUPPORTED_IN_PHASE1`
3. 强校验：`Σ allocatedAmount_i == receipt.amount`；不等则事务回滚并返回 400（对应 §1.1 S3）
4. receipts POST 的 allocation 分支额外约束：
   - 传入 `allocations[]` 时，`orderId` / `externalOrderInvoiceRequestId` / `projectInvoiceId` 必须为空
   - **必须改造现有 `orderId` 必填 guard**：`allocations[]` 存在时允许 `orderId` 为空（且应拒绝传入）；`allocations[]` 不存在时保持现状 `orderId` 必填
   - `customerId` 由 allocation 关联发票/订单重算，不信任前端直传

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
  orderId         String?   // 冗余便于按订单直接聚合；Phase 1 仅允许 direct-order invoice，因此与 invoice.orderId 应一致
  order           Order?    @relation(fields: [orderId], references: [id])
  amount          Float     // 本次核销分摊金额（单位与 FinanceReceipt.amount 一致）
  createdById     String?
  createdBy       User?     @relation("ReceiptAllocationCreatedBy", fields: [createdById], references: [id])
  createdAt       DateTime  @default(now())
  @@unique([receiptId, invoiceId])
  @@index([invoiceId])
  @@index([orderId])
  @@index([createdById])
}
```

设计取舍：
- `orderId` 冗余：违反 3NF，但让"订单回款总额"查询可以单表聚合，不必 join invoice。写入时强制校验 `allocation.orderId == invoice.orderId`
- `receipt` relation 仍可保留 `onDelete: Cascade` 以覆盖未来极少数 hard delete，但**本项目实际 receipt 删除语义是软删除**；因此运行时聚合不能依赖 cascade，而必须过滤 `receipt.deleted = false`

### 6.2 `FinanceReceipt` 侧

- 新增反向关系：
  ```prisma
  model FinanceReceipt {
    // ...
    allocations FinanceReceiptAllocation[]
  }
  ```
- `source` 枚举**不变**，继续复用现有 `MANUAL | BANK | PINGOODMICE_ORDER | OTHER`
- v2.2 约定：当 receipt 含 `allocations[]` 时，`orderId` / `externalOrderInvoiceRequestId` / `projectInvoiceId` 三个 1-to-1 字段**必须为 NULL**，由 allocation 表承载
- v2.2 约定：**Phase 1 内** `receipt.allocations.length > 0` 可视为"凭证匹配产生的回款"。后续若手工录入也改走 allocation，则必须再补机器可读标识，不能继续仅靠 `allocations.length > 0` 区分
- DELETE 语义保持软删除：`deleted=true` 后保留 allocation 行用于审计，但所有业务聚合必须视其为无效

### 6.3 `ExternalOrderInvoiceRequest` 侧

- 新增反向关系：
  ```prisma
  model ExternalOrderInvoiceRequest {
    // ...
    allocations FinanceReceiptAllocation[]
  }
  ```
- 不新增冗余字段；outstanding 通过聚合计算（见 §4.1）

### 6.4 `Order` 侧

- 新增反向关系，承接 `FinanceReceiptAllocation.orderId`：
  ```prisma
  model Order {
    // ...
    invoiceAllocations FinanceReceiptAllocation[]
  }
  ```

### 6.5 `User` 侧

- 新增反向关系，承接 `FinanceReceiptAllocation.createdBy`：
  ```prisma
  model User {
    // ...
    financeReceiptAllocations FinanceReceiptAllocation[] @relation("ReceiptAllocationCreatedBy")
  }
  ```

### 6.6 迁移

`npx prisma migrate dev --name add_finance_receipt_allocation`；`db push` 用于开发期。

---

## 7. API 设计

### 7.1 `POST /api/finance/payment-vouchers/match`（v2 扩展响应）

只做匹配计算，**不写库**。

请求：
```json
{
  "organizationId": "org_xxx",
  "amount": 125800,
  "receivedAt": "2026-06-10"
}
```

响应（命中）：
```json
{
  "status": "MATCHED",
  "organization": { "id": "...", "canonicalName": "..." },
  "candidateInvoices": [
    { "id": "...", "invoiceNo": "...", "totalAmount": 50000, "outstanding": 50000, "issuedAt": "...", "orderId": "..." }
  ],
  "orphanInvoiceCount": 3,
  "excludedCoveredInvoiceCount": 2,
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
  "excludedCoveredInvoiceCount": 0,
  "candidateTotal": 0,
  "nearestBelow": { "sum": 124500, "delta": -1300, "count": 3 },
  "nearestAbove": { "sum": 127000, "delta": 1200, "count": 4 },
  "degraded": false
}
```

### 7.2 `POST /api/finance/receipts` 的 allocation 分支（v2 强校验）

复用现有 receipt 创建接口写库，不新增 confirm 路由。

请求：
```json
{
  "amount": 125800,
  "receivedAt": "2026-06-10",
  "source": "BANK",
  "organizationId": "org_xxx",
  "allocations": [
    { "invoiceId": "inv_a", "amount": 50000 },
    { "invoiceId": "inv_b", "amount": 45000 },
    { "invoiceId": "inv_c", "amount": 30800 }
  ],
  "remark": "..."
}
```

后端：
- **权限**：复用现有 receipts POST 的 `ADMIN | USER` 校验
- **校验**：
  - 传入 `allocations[]` 时，拒绝 `orderId` / `externalOrderInvoiceRequestId`
  - 每张发票仍 ISSUED 且未冲红
  - 每张发票的 `buyerOrganizationId == request.organizationId`（防御跨机构）
  - 每张发票必须满足 `orderId != NULL && orderCoverage = []`（Phase 1 排除 covered invoice）
  - `outstanding_i > 0`（重算时刻）
  - `Σ outstanding_i == receipt.amount`（**强校验，对应 §1.1 S3**）
- 事务内创建 `FinanceReceipt` + N 条 `FinanceReceiptAllocation`
- 并发超核销时返回 409

响应：
```json
{
  "receipt": { "id": "...", "amount": 125800, "receivedAt": "2026-06-10", "source": "BANK" },
  "allocations": [
    { "invoiceId": "...", "orderId": "...", "amount": 50000, "newOutstanding": 0 }
  ],
  "crossOrder": true,
  "orderBreakdown": [ { "orderId": "...", "sum": 80000 }, { "orderId": "...", "sum": 45800 } ]
}
```

---

## 8. 权限（v2 重写，对应 finding #6）

### 8.1 路由级校验

- `POST /api/finance/payment-vouchers/match`：`canReadFinance`（REGIONAL_MANAGER 可查看自己 scope 内的候选）
- `POST /api/finance/receipts` allocation 分支：复用现有 receipts POST 的 `ADMIN | USER` 校验
- 候选集先求 `getFinanceCustomerScopeWhere(session.user.id, session.user.role)`，再以 relation 条件 AND 到 invoice where；不能把 customer scope 对象直接塞进 `ExternalOrderInvoiceRequest.where`

### 8.2 审计

- receipts POST allocation 分支写 `FinanceReceipt.createdById = session.user.id`
- 每条 `FinanceReceiptAllocation.createdById = session.user.id`

---

## 9. 冲红 / 编辑 / 删除的关联影响（v2 新增，对应 finding #7）

### 9.1 RED 冲红前置校验

在 `src/lib/finance/order-invoices.ts` 新增共享 helper，例如 `assertInvoiceNotOccupied(invoiceId)`，由 RED / REISSUE 等路由复用。`src/app/api/finance/order-invoices/[id]/red/route.ts` 可调用：

```ts
const occupied = await prisma.financeReceiptAllocation.count({
  where: {
    invoiceId: params.id,
    receipt: { deleted: false },
  },
})
const legacyOccupied = await prisma.financeReceipt.count({
  where: {
    externalOrderInvoiceRequestId: params.id,
    deleted: false,
  },
})
if (occupied > 0 || legacyOccupied > 0) {
  return NextResponse.json(
    { error: "INVOICE_OCCUPIED", message: "该发票已有回款核销，请先撤销核销再冲红" },
    { status: 409 }
  )
}
```

v2 同时查新表和历史 1-to-1 字段，避免"双标"；实现上不要把这段逻辑散写在单个 route handler 内。

### 9.2 Receipt DELETE

修改 `src/app/api/finance/receipts/[id]/route.ts`：
- 已有软删除逻辑保留
- 不删除 `FinanceReceiptAllocation` 行；写入 `FinanceReceiptDeletionLog.snapshotJson`，其中包含原 receipt 快照 + `allocations` 快照
- 后续所有 outstanding / payment-status / order totals / RED occupation 查询统一过滤 `receipt.deleted = false`

### 9.3 Receipt PATCH

- 禁止修改含 allocation 的 receipt 的 `amount`（会导致分摊不等）
- 允许修改 `remark`、`receivedAt`（审计记录）

---

## 10. UI 改动清单（v2 扩展，对应 finding #2）

| 文件 | 改动 |
|------|------|
| `src/app/finance/order-receivables/page.tsx` | 顶部增加"凭证匹配"按钮（沿用现有 `ADMIN | USER` 可写权限判断） |
| 新建 `src/components/finance/payment-voucher-wizard.tsx` | 三步向导（录入 / 机构确认 / 结果 / 完成），用 shadcn `Dialog` + `Tabs`；内部直接复用现有 `FinanceDataTable`、`MoneyText`、`OrganizationSelect`，不再拆子组件文件 |
| `src/components/finance/receipt-form-dialog.tsx` | receipt 含 `allocations[]` 时隐藏 1-to-1 字段，改展示 allocation 列表 |
| `src/app/finance/invoice-receipt-detail/page.tsx` | 列表新增"核销发票数"列，点击展开 allocation 表 |
| `src/lib/finance/order-receivables.ts` | 直接重写现有 `getOrderReceiptTotals` 内部聚合逻辑 |
| `src/lib/finance/payment-status.ts` | `computeInvoicePaymentStatus` 同上 |
| `src/lib/finance/order-invoices.ts` | 复用 `getInvoicesForOrder` 的 `_receiptAmount` / outstanding 口径，并新增 `assertInvoiceNotOccupied` helper |
| `src/app/api/finance/order-invoices/[id]/red/route.ts` | 新增占用校验（见 §9.1） |
| `src/app/api/finance/receipts/route.ts` | POST 增加 `allocations[]` 分支，复用现有 receipt 创建 / audit 链路 |
| `src/app/api/finance/receipts/[id]/route.ts` | GET 返回 `allocations[]`；PATCH 拒绝含 allocation 的 amount 修改；DELETE 同时写 allocation 快照 |

---

## 11. 风险与缓解（v2 扩展）

| 风险 | 缓解 |
|------|------|
| 候选发票数 n 较大时组合爆炸 | `MAX_RESULTS=20` + suffixPossible 强剪枝；当 `n>40`、`T>10^7` 分或预估 `O(n·T)` 内存超限时，直接降级为只返回最近邻 |
| 金额用 Float 导致精度问题 | 算法内部全部乘 100 转整数（分），DB 层仍用 Float（与现有保持一致） |
| 并发：两次匹配选中同一张发票 | receipts POST 的 allocation 分支在事务内重算 `outstanding` 并校验 `Σ == receipt.amount`，冲突返回 409 |
| 机构解析误命中 | 步骤 1.5 强制用户确认 canonicalName；支持改选 |
| 发票实际覆盖多个订单，`allocation.orderId` 无法代表真实经济归属 | Phase 1 直接排除 `orderCoverage` 非空发票；后续单独设计 multi-order allocation 语义 |
| RED 冲红后仍有核销残留 | v2：冲红前置校验同时查新表 + 历史 1-to-1 字段 |
| 已有 `FinanceReceipt.externalOrderInvoiceRequestId` 历史数据 | v2：所有聚合函数 UNION 新旧两条路径 |
| v1 的 `FinanceReceipt.orderId` 回填导致跨订单回款错配 | v2：不再回填；改为按 allocation 聚合（见 §4） |
| 跨订单核销后，订单维度的回款统计出现"一笔凭证计入多订单" | 这正是 v2 的预期语义；UI 在向导步骤 3 明确展示 `orderBreakdown` 让用户核对 |
| receipt 软删除后 allocation 仍留库，若漏过滤会造成已删核销继续占用 | 所有 allocation 聚合 helper 和 RED occupation check 强制内置 `receipt.deleted = false` 过滤 |
| 聚合口径重写引入回归 bug | Phase 1 落地时补一套 smoke：对 5 个典型 fixture（单订单 / 跨订单 / 历史 1-to-1 / RED 冲红 / 部分核销）断言 `getOrderReceiptTotals`、`getInvoicesForOrder`、`computeInvoicePaymentStatus` 的输出 |

---

## 12. 分阶段落地建议（v2 调整）

- **Phase 1**（本次）
  - 向导 + 算法 + `FinanceReceiptAllocation` 表 + 1 个新 match API + 扩展现有 receipts POST
  - 重写 §4.2 列出的 6 个聚合点
  - 冲红 / DELETE / PATCH 的关联改造
  - 候选范围仅限 `orderId != NULL && orderCoverage = []` 的 invoice
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
- **不支持 `OrderInvoiceCoverage` 发票自动匹配**：多订单覆盖发票继续走人工核销或后续 Phase 设计

---

## 14. v1 → v2 变更对照（保留供评审参考）

| 章节 | v1 决策 | v2 决策 | 触发 finding |
|------|---------|---------|--------------|
| §1.1 核心承诺 | 无 | 新增 6 条语义承诺 | #1 #3 + 第二轮 review |
| §2 工作流 | 提供"手动勾选 + 部分核销" | 禁用，仅精确命中可确认 | #3 |
| §3.1 候选筛选 | `buyerOrganizationId = orgId` | 同 + 可见 scope 叠加 + 排除 NULL；机构解析前移到现有 `/api/organizations/resolve` | #5 + 收敛 review |
| §3.1 候选筛选（第二轮） | 默认所有 direct invoice 均可参与 | Phase 1 明确排除 `orderCoverage` 非空发票，并修正 customer scope 映射方式 | 第二轮 review |
| §3.2 算法 | 一维 DP + 值去重回溯 | 带索引回溯 + suffixPossible + 保留 identity | #4 |
| §4（旧）写库 | `FinanceReceiptInvoice` 1:N；receipt.orderId 回填第一个 order | 删除 §4，改为 §5 + §4 聚合口径重写 | #1 #2 |
| §5（旧）模型 | `FinanceReceiptInvoice` | `FinanceReceiptAllocation`（带 orderId 冗余） | #1 |
| §6 API | confirm 宽松校验 | 删除独立 confirm 路由，改扩展 `POST /api/finance/receipts` 的 allocation 分支 | 收敛 review |
| §7 权限 | "复用 canReadFinance" | match 保留 `canReadFinance`；写库复用现有 receipts POST 的 `ADMIN | USER` 校验 | #6 + 收敛 review |
| §8（旧）UI | 6 个文件 | 以 wizard 为主，复用现有 `FinanceDataTable` / `MoneyText` / `OrganizationSelect`，减少新增子组件 | #2 + 收敛 review |
| §9 冲红 | 仅查新表 | 同时查新表 + 历史 1-to-1 | #7 |

---

## 15. 评审检查清单（v2）

- [ ] `FinanceReceiptAllocation` 命名与 Prisma 风格一致
- [ ] 算法对 n>40 的降级路径已在 match API 中明确返回 `degraded: true`
- [ ] receipts POST 的 allocation 分支在事务内重算 `outstanding`（避免脏读）
- [ ] 冲红 API 同时查新表 + 历史 1-to-1
- [ ] 所有 allocation 聚合与 occupation check 都显式过滤 `receipt.deleted = false`
- [ ] source 继续复用 `BANK`，不新增 `BANK_VOUCHER`
- [ ] 机构解析步骤复用现有 `/api/organizations/resolve` + `OrganizationSelect`
- [ ] 直接改 `getOrderReceiptTotals` / `getInvoicesForOrder` / `computeInvoicePaymentStatus`，不新增同义 wrapper
- [ ] 金额内部统一使用整数"分"参与 DP
- [ ] receipt 含 `allocations[]` 时详情页展示 allocation 列表而非 1-to-1 字段
- [ ] 跨订单核销在向导步骤 3 明确展示 `orderBreakdown`，用户可核对
- [ ] match API 与 receipts POST allocation 分支都拒绝 `orderCoverage` 非空的 covered invoice
- [ ] `FinanceReceiptAllocation.createdById` 已写入并与 `User` 建立 relation
- [ ] `FinanceReceiptDeletionLog.snapshotJson` 包含 receipt + allocations 快照
- [ ] wizard 内直接复用 `FinanceDataTable` / `MoneyText`，不新增 `combination-card.tsx` / `invoice-picker-table.tsx`

---

## 相关文档索引

| 编号 | 文件 | 主题 |
|------|------|------|
| DOC-001 | `docs/finance-payment-voucher-matching-design.md`（本文件） | 财务到款凭证 — 发票自动组合匹配方案 |
