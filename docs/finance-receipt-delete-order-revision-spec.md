# Spec: 到款删除审计与订单金额修订

## 状态

本文档是可执行实现规格，目标是补齐两个财务流程：

1. 到款记录允许删除，但必须保留删除记录和原始快照。
2. 订单金额允许后置修订，修订差额必须同步订单、项目、财务，并作为修订发生月份的进度款调整项体现。

本文档面向实现者。默认不做大范围重构，只在现有统一订单、财务和项目模型上追加审计与调整能力。

## 核心原则

### 到款删除

到款记录不能物理删除。

删除动作应理解为：

`有效到款 -> 已删除到款 + 删除审计记录`

所有正常财务统计默认只计算 `deleted = false` 的到款。

### 订单修订

订单金额修订不能直接覆盖历史财务事实。

订单本体保存最新商业事实：

`Order.totalAmount / OrderLine / OrderProjectLink.allocatedAmount`

修订记录保存审计事实：

`OrderRevision`

本月进度款影响保存为财务调整事实：

`ProgressReceivableAdjustment`

例如：

1. 订单发生在 3 月。
2. 3 月已经计算过进度款。
3. 4 月订单金额从 10000 修订为 8000。
4. 订单最新金额变为 8000。
5. 3 月历史进度款不回写。
6. 4 月生成一条 `-2000` 或按服务进度比例折算后的进度款调整项。

## 一、到款删除审计

### 数据模型

在 `FinanceReceipt` 上新增软删除字段：

```prisma
model FinanceReceipt {
  id        String   @id @default(cuid())
  // existing fields...

  deleted      Boolean   @default(false)
  deletedAt    DateTime?
  deletedById  String?
  deleteReason String?

  deletionLogs FinanceReceiptDeletionLog[]

  @@index([deleted])
  @@index([deletedAt])
}
```

新增删除日志表：

```prisma
model FinanceReceiptDeletionLog {
  id        String @id @default(cuid())
  receiptId String
  receipt   FinanceReceipt @relation(fields: [receiptId], references: [id], onDelete: Cascade)

  amount     Float
  receivedAt DateTime
  orderId    String?
  customerId String?
  projectId  String?
  source     String?
  remark     String?

  reason       String?
  snapshotJson String
  deletedById  String
  deletedAt    DateTime @default(now())

  @@index([receiptId])
  @@index([deletedAt])
}
```

`snapshotJson` 必须保存删除前完整 receipt 结构，至少包含：

1. 到款基础字段。
2. 订单、项目、客户关联。
3. 发票关联。
4. 预收款结算关联。
5. 创建人与创建时间。

### API 修改

修改：

`DELETE /api/finance/receipts/[id]`

现状是硬删除，需要改为事务软删除。

流程：

1. `getServerSession(authOptions)` 校验登录。
2. 校验角色，第一版建议仅 ADMIN 可删除。
3. 查询 receipt，包含：
   - `settledAdvances`
   - `settledAdvanceRefunds`
   - `order`
   - `customer`
   - `project`
   - `projectInvoice`
   - `externalOrderInvoiceRequest`
4. 如果不存在，返回 404。
5. 如果 `deleted = true`，返回 409，提示已删除。
6. 如果已用于预收款核销或预收款退款核销，第一版返回 409，提示先解除核销关系。
7. 在事务中创建 `FinanceReceiptDeletionLog`。
8. 在事务中更新 `FinanceReceipt.deleted = true`、`deletedAt`、`deletedById`、`deleteReason`。
9. 返回删除后的 receipt id 和 deletion log id。

请求体：

```ts
{
  reason?: string;
}
```

建议原因可选但 UI 强制填写。

### 查询口径

所有正常查询和统计必须排除已删除到款：

```ts
where: {
  deleted: false,
}
```

重点检查：

1. `src/app/api/finance/receipts/route.ts`
2. `src/app/api/finance/receipts/[id]/route.ts`
3. `src/lib/finance/calculations.ts`
4. `src/lib/finance/payment-status.ts`
5. `src/lib/finance/order-receivables.ts`
6. `src/lib/finance/order-invoices.ts`
7. `src/app/api/orders/[id]/summary/route.ts`
8. `src/app/api/finance/order-receivables/route.ts`
9. `src/app/api/finance/advances/[id]/eligible-receipts/route.ts`

列表 API 可增加参数：

```txt
includeDeleted=1
deletedOnly=1
```

默认：

1. 普通用户不返回已删除记录。
2. ADMIN 可通过参数查看已删除记录。
3. 单条 receipt 详情如果已删除，普通用户返回 404，ADMIN 可查看。

### UI 修改

到款列表增加删除入口：

1. 操作列增加“删除”按钮。
2. 点击后弹出确认框。
3. 确认框要求填写删除原因。
4. 删除成功后刷新列表和财务摘要。

ADMIN 增加已删除记录入口：

1. 可用筛选项“包含已删除”或 tab“已删除”。
2. 已删除记录置灰展示。
3. 展示删除人、删除时间、删除原因。
4. 不允许编辑已删除记录。

### 验收标准

1. 删除到款后，普通到款列表不再显示。
2. 删除到款后，订单已收款、客户回款、财务汇总同步减少。
3. 数据库中 `FinanceReceipt` 行仍存在。
4. `FinanceReceiptDeletionLog` 存在删除快照。
5. 已用于预收款核销的到款第一版不能删除，返回明确错误。

## 二、订单金额修订

### 问题定义

当前普通订单编辑直接改金额会造成两个问题：

1. 历史月份进度款可能被重算或口径混乱。
2. 已开票、已到款、项目分摊和进度款缺少审计链路。

因此需要新增专门的订单修订流程。

### 数据模型

新增 `OrderRevision`：

```prisma
model OrderRevision {
  id      String @id @default(cuid())
  orderId String
  order   Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)

  revisionNo Int

  oldTotalAmount   Float
  newTotalAmount   Float
  deltaTotalAmount Float

  oldFinanceAmount   Float
  newFinanceAmount   Float
  deltaFinanceAmount Float

  effectiveAt     DateTime @default(now())
  effectivePeriod String

  reason       String
  snapshotJson String?

  createdById String
  createdAt   DateTime @default(now())

  adjustments ProgressReceivableAdjustment[]

  @@unique([orderId, revisionNo])
  @@index([orderId])
  @@index([effectivePeriod])
}
```

新增 `ProgressReceivableAdjustment`：

```prisma
model ProgressReceivableAdjustment {
  id String @id @default(cuid())

  sourceType String // ORDER_REVISION
  sourceId   String
  revision   OrderRevision @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  orderId    String?
  projectId  String?
  customerId String?

  periodKey  String
  occurredAt DateTime @default(now())

  amount   Float
  category String
  reason   String?

  createdById String
  createdAt   DateTime @default(now())

  @@index([periodKey])
  @@index([orderId])
  @@index([projectId])
}
```

字段说明：

1. `effectivePeriod` 和 `periodKey` 使用 `YYYY-MM`。
2. `amount` 使用带符号金额，正数表示新增，负数表示扣减。
3. `sourceType` 第一版固定为 `ORDER_REVISION`。
4. 不要为了扣减或新增去创建真实 `Project`，前端把 adjustment 显示成虚拟进度款明细即可。

可选增强：

如果需要记录多项目分摊前后变化，可以新增：

```prisma
model OrderRevisionProjectAllocation {
  id String @id @default(cuid())

  revisionId String
  projectId  String
  orderProjectLinkId String?

  oldAllocatedAmount Float?
  newAllocatedAmount Float?
  deltaAllocatedAmount Float

  createdAt DateTime @default(now())

  @@index([revisionId])
  @@index([projectId])
}
```

第一版如果项目分摊逻辑较简单，可以先不建这张表，把分摊快照放入 `OrderRevision.snapshotJson`。

### API 设计

新增：

`POST /api/orders/[id]/revisions`

权限：

1. 第一版建议 ADMIN-only。
2. 后续如有财务角色，再放开到财务管理员。

请求体：

```ts
{
  newTotalAmount: number;
  reason: string;
  effectiveAt?: string;
  lines?: Array<{
    id?: string;
    name: string;
    quantity?: number;
    unitPrice?: number;
    amount: number;
  }>;
  allocations?: Array<{
    projectId: string;
    allocatedAmount: number;
  }>;
  syncProjectBudget?: boolean;
}
```

响应：

```ts
{
  revision: OrderRevision;
  adjustments: ProgressReceivableAdjustment[];
  order: Order;
}
```

### 修订事务流程

在一个 `prisma.$transaction()` 内完成：

1. 加载订单，包含：
   - `lines`
   - `projectLinks`
   - `receipts`
   - `invoiceRequests`
   - `customer`
2. 校验订单存在且未删除。
3. 校验 `reason` 非空。
4. 校验 `newTotalAmount >= 0`。
5. 计算旧财务金额：

```ts
oldFinanceAmount = order.financeAmountOverride ?? order.totalAmount
newFinanceAmount = newTotalAmount
deltaFinanceAmount = newFinanceAmount - oldFinanceAmount
```

6. 如果 `deltaFinanceAmount === 0`，返回 400，提示无需修订。
7. 统计已开票金额。
8. 如果 `newFinanceAmount < issuedOrRequestedInvoiceAmount`，第一版建议阻止，提示先冲红或重开。
9. 统计已到款金额。
10. 如果 `newFinanceAmount < receivedAmount`，允许保存，但响应和 UI 必须提示“已超收”。
11. 生成下一个 `revisionNo`。
12. 创建 `OrderRevision`，写入修订前后金额和快照。
13. 更新 `Order.totalAmount`。
14. 如果传入 `lines`，同步替换或更新 `OrderLine`。
15. 同步 `OrderProjectLink.allocatedAmount`。
16. 视情况更新 `Project.budgetAmount`。
17. 创建 `ProgressReceivableAdjustment`。
18. 写订单状态历史或活动日志。

### 项目同步规则

订单与项目金额同步必须保守。

#### 单项目关联

如果订单只关联一个项目：

1. 默认把该 `OrderProjectLink.allocatedAmount` 更新为 `newFinanceAmount`。
2. 如果 `syncProjectBudget = true`，同时更新 `Project.budgetAmount`。
3. 如果 `syncProjectBudget = false`，项目预算不改，只调整订单分摊和财务调整项。

#### 多项目关联

如果订单关联多个项目：

1. 请求体必须传 `allocations`。
2. `allocations` 的合计必须等于 `newFinanceAmount`。
3. 每个项目按分摊金额差额生成对应的进度款调整项。
4. 不允许系统自动平均分配。

#### 无项目关联

按独立订单处理。

只更新订单金额，并生成订单维度的进度款调整项。

### 进度款调整计算

调整项永远进入修订发生月份。

```ts
periodKey = formatYYYYMM(effectiveAt ?? new Date())
```

不要使用订单原始月份。

#### 商品类或产品类

商品订单按 100% 确认：

```ts
adjustmentAmount = deltaFinanceAmount
```

#### 独立服务订单

沿用当前独立服务订单 30% 口径：

```ts
adjustmentAmount = deltaFinanceAmount * 0.3
```

#### 项目关联服务订单

根据项目在修订发生时的交付状态判断：

1. 项目尚未开始：`adjustmentAmount = 0`
2. 项目已开始未完成：`adjustmentAmount = deltaAllocatedAmount * 0.3`
3. 项目已完成：`adjustmentAmount = deltaAllocatedAmount`

这样可以保证：

1. 已经在历史月份确认过的部分不回写。
2. 当前月份补确认金额差。
3. 后续完成时仍可按新金额计算剩余部分。

示例：

1. 3 月项目开始，原金额 10000，3 月确认 3000。
2. 4 月修订为 8000，差额 -2000。
3. 4 月生成调整项 `-600`。
4. 后续项目完成时按 8000 的 70% 确认 5600。
5. 总确认 = 3000 - 600 + 5600 = 8000。

如果项目在 4 月修订前已经完成：

1. 原金额 10000 已确认 10000。
2. 修订为 8000。
3. 4 月生成调整项 `-2000`。
4. 总确认 = 8000。

### 财务计算修改

需要把调整项加入进度款汇总。

重点修改：

1. `src/lib/finance/progress.ts`
2. `src/app/api/finance/progress-receivables/route.ts`
3. `src/lib/finance/calculations.ts`
4. `src/lib/finance/ledger.ts`

建议新增工具函数：

```ts
getProgressAdjustmentsForPeriod(periodKey)
getProgressAdjustmentsForDateRange(start, end)
computeRevisionAdjustmentAmount(order, projectLink, deltaAmount, effectiveAt)
```

汇总口径：

```ts
baseProgressReceivable = existingComputedAmount
progressAdjustment = sum(ProgressReceivableAdjustment.amount)
totalProgressReceivable = baseProgressReceivable + progressAdjustment
```

详情列表应返回两类行：

1. 正常项目或订单进度款。
2. 订单修订调整项。

调整项展示字段建议：

```ts
{
  type: "ORDER_REVISION_ADJUSTMENT",
  orderId,
  projectId,
  customerName,
  amount,
  periodKey,
  reason,
  revisionId
}
```

### UI 修改

#### 订单详情页

新增“修订订单金额”按钮。

弹窗字段：

1. 当前订单金额。
2. 新订单金额。
3. 差额。
4. 已开票金额。
5. 已到款金额。
6. 关联项目分摊。
7. 是否同步项目预算。
8. 影响月份。
9. 预计生成的进度款调整。
10. 修订原因。

提交前必须预览调整结果。

#### 订单详情增加修订历史

展示：

1. 修订编号。
2. 修订前金额。
3. 修订后金额。
4. 差额。
5. 影响月份。
6. 修订人。
7. 修订时间。
8. 原因。
9. 关联调整项。

#### 财务进度款页面

进度款明细增加调整项行。

文案建议：

1. 正数：`订单修订新增进度款`
2. 负数：`订单修订扣减进度款`

负数金额用红色展示。

点击调整项可跳转到订单详情或修订历史。

### 权限与边界

#### 权限

第一版：

1. 到款删除：ADMIN-only。
2. 订单修订：ADMIN-only。
3. 查看修订历史：有订单读取权限即可。
4. 查看删除到款：ADMIN-only。

#### 发票边界

如果新订单金额小于已申请或已开具发票金额：

1. 第一版阻止修订。
2. 提示先走发票冲红或重开。

#### 到款边界

如果新订单金额小于已到款金额：

1. 可以允许。
2. 订单财务状态显示超收。
3. 后续如要退款，另走退款流程。

#### 多项目边界

多项目订单必须明确传入分摊金额。

不允许自动平均分摊，避免财务口径不可解释。

#### 负数调整

允许 `ProgressReceivableAdjustment.amount < 0`。

财务页面和导出必须支持负数。

### 实施步骤

建议按以下顺序实现：

1. 修改 Prisma schema，新增 receipt 软删除字段和删除日志表。
2. `npx prisma db push`。
3. 修改 receipt DELETE API 为软删除。
4. 所有 receipt 查询和统计默认过滤 `deleted = false`。
5. 到款列表增加删除 UI 和已删除查看入口。
6. 修改 Prisma schema，新增 `OrderRevision` 和 `ProgressReceivableAdjustment`。
7. `npx prisma db push`。
8. 新增 `POST /api/orders/[id]/revisions`。
9. 实现订单修订事务。
10. 修改进度款计算，把 adjustment 加入本月汇总。
11. 订单详情新增修订弹窗和修订历史。
12. 财务进度款页面展示修订调整项。
13. 跑 `npm run lint`。
14. 跑 `npx tsc --noEmit`。
15. 部署 demo 验证。

### 最小验收清单

#### 到款删除

1. 普通到款可以删除。
2. 删除后普通列表不显示。
3. 删除后财务统计减少。
4. 删除日志能看到原始金额、订单、项目、客户、删除人和原因。
5. 数据库没有物理删除 receipt。

#### 订单修订

1. 3 月订单在 4 月修订，4 月产生调整项。
2. 3 月进度款不被回写。
3. 金额减少生成负数调整。
4. 金额增加生成正数调整。
5. 单项目订单能同步 `OrderProjectLink.allocatedAmount`。
6. 多项目订单必须填写分摊。
7. 已开票金额超过新金额时阻止修订。
8. 已到款金额超过新金额时允许修订但显示超收。
9. 财务进度款页面能看到调整项。
10. 订单详情能看到修订历史。

## 实现注意事项

1. API route 必须内联调用 `getServerSession(authOptions)`。
2. Prisma Client 必须从 `@/lib/prisma` 导入。
3. 订单、财务、发票相关 scope 查询必须用 `AND` 合并，不要覆盖原有 where。
4. 事务内不要拆开写多表，避免订单已改但调整项没生成。
5. 不要用普通订单 PATCH 代替修订接口。
6. 不要创建真实 Project 作为扣减或新增项目。
7. 所有金额差额都要保留审计记录。
8. 所有删除和修订动作都必须写操作者。

