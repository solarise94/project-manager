# 订单导入、主数据联动、AI 兼容层、垫付、代表订单视图、真实发票上传实施计划

## 状态

本文是给后续实现 agent 的执行文档，目标是在现有统一订单模型基础上，补齐以下 6 个改动：

1. 把“拼好鼠订单导入”统一成“导入订单列表”，并把 import 区域的命名改成通用口径。
2. 外部订单导入时支持联动导入客户和机构。
3. 为外部订单导入增加 AI 兼容层，把客户上传的宽表/乱表整理成系统可识别的标准表后再导入。
4. 在财务/订单回款场景增加“客户垫付”和“垫付退款”。
5. 代表口径可以看到属于自己客户的订单，并展示是否开票、是否回款。
6. 开票申请后可上传真实发票，并在发票/订单/财务视图中明确“是否已回款”。

本文不是抽象方案讨论，重点是让 DeepSeek 能按阶段直接实现。

实现完成后至少验证：

```bash
npm run lint
npm run build
```

## 当前代码现状

### 1. 导入入口仍然是拼好鼠专用

现状文件：

1. `src/app/orders/import/pingoodmice/page.tsx`
2. `src/app/api/orders/import/pingoodmice/route.ts`
3. `src/app/orders/page.tsx`
4. `src/app/external-orders/page.tsx`

当前行为：

1. 页面标题、按钮文案、组件名都是“拼好鼠导入”。
2. UI 虽然调用时传了 `source: "PINGOODMICE"`，但入口和命名都是单渠道定制。
3. 解析逻辑其实已经是半通用的：`parseOrderText(source, rawText)` 接口是通用签名，但表头映射仍主要服务拼好鼠。

### 2. 当前导入不会自动新建客户和机构

现状文件：

1. `src/app/api/orders/import/pingoodmice/route.ts`
2. `src/lib/external-order.ts`

当前行为：

1. 导入只会创建 `Order`、`OrderSourceRecord`、`OrderLine`。
2. 不会创建 `Customer`。
3. 不会创建 `Organization`。
4. 也不会创建 `CrmCustomerProfile`。
5. 订单导入后客户绑定仍依赖后续匹配流程或人工绑定。

### 3. 已有客户自动匹配逻辑，但只用于后置匹配

现状文件：

1. `src/lib/finance/pingoodmice-match.ts`
2. `src/app/api/finance/pingoodmice/match-scan/route.ts`

当前行为：

1. 已有一套订单 -> 客户的匹配 heuristics。
2. 匹配会更新 `Order.customerId` 与 `customerMatchStatus`。
3. 但它不会在导入事务内创建客户或机构。
4. 文件名和接口路径仍然带 `pingoodmice`，不适合作为通用导入能力长期承载。

### 4. 财务里只有“回款”，没有“垫付/退款”

现状文件：

1. `prisma/schema.prisma` 中的 `FinanceReceipt`
2. `src/app/api/finance/receipts/route.ts`
3. `src/components/finance/receipt-form-dialog.tsx`
4. `src/app/finance/invoice-status/page.tsx`
5. `src/app/finance/customers/[customerId]/page.tsx`

当前行为：

1. `FinanceReceipt` 只表达“到款事实”。
2. 目前没有单独的“客户垫付”模型。
3. 也没有“垫付退款”模型。
4. 如果硬把垫付和退款塞进 `FinanceReceipt`，会污染“真实回款”口径。

### 5. 代表当前只能通过项目链路看到订单

现状文件：

1. `src/lib/orders/permissions.ts`
2. `src/app/api/orders/route.ts`
3. `src/app/api/crm/representatives/[representativeId]/route.ts`
4. `src/app/crm/representatives/[representativeId]/page.tsx`

当前行为：

1. `REPRESENTATIVE` / `REGIONAL_MANAGER` 的订单权限目前主要来自项目关联。
2. 没有把“CRM 名下客户的订单”纳入代表订单视图主口径。
3. 代表详情页目前只有客户、拜访、跟进、周报，没有订单 tab。

### 6. 发票模型还没有“真实发票文件”

现状文件：

1. `ProjectInvoice`
2. `ExternalOrderInvoiceRequest`
3. `src/components/invoice-form-dialog.tsx`
4. `src/app/api/finance/order-invoices/route.ts`
5. `src/app/finance/invoices/page.tsx`

当前行为：

1. 当前只有“发票申请单”数据。
2. 没有上传真实发票附件的字段或独立文件模型。
3. “是否已回款”目前也不是 invoice 级显式计算字段，而是通过回款工作台间接看。

## 设计原则

1. 不直接重命名数据库中的 `Order.source = "PINGOODMICE"` 历史值。数据枚举继续保留，避免迁移放大。
2. 重命名“模块/页面/API 命名”和“通用 import helper 命名”，不强推一次性改完全仓所有 legacy 标识。
3. 导入流程拆成“预览/标准化/提交”三段，不做一次性黑盒落库。
4. 客户垫付不算真实营收回款，必须与 `FinanceReceipt` 分开建模。
5. “已回款”不做手工布尔开关，必须由 `FinanceReceipt` 聚合计算。
6. 代表可以看到自己客户的订单财务状态，但不开放财务 CRUD。

## 目标结构

### 导入产品口径

统一命名为“导入订单列表”。

建议最终入口：

1. 页面：`/orders/import`
2. 预览 API：`POST /api/orders/import/preview`
3. AI 标准化 API：`POST /api/orders/import/ai-normalize`
4. 提交 API：`POST /api/orders/import/commit`
5. 模版下载：`GET /api/orders/import/template`

兼容保留：

1. `/orders/import/pingoodmice` 重定向到 `/orders/import?source=PINGOODMICE`
2. `/api/orders/import/pingoodmice` 保留一层薄代理，内部转调新 preview/commit 逻辑

### 推荐目录

新增一组通用 import helper，不再继续把新逻辑塞进 `src/lib/external-order.ts`：

1. `src/lib/orders/import-parser.ts`
2. `src/lib/orders/import-template.ts`
3. `src/lib/orders/import-preview.ts`
4. `src/lib/orders/import-masterdata.ts`
5. `src/lib/orders/import-ai.ts`
6. `src/lib/orders/import-commit.ts`
7. `src/lib/orders/source-order-match.ts`

兼容策略：

1. `src/lib/external-order.ts` 暂时保留 legacy external-order 兼容逻辑。
2. 旧的 `src/lib/finance/pingoodmice-match.ts` 可先改为 re-export 新 helper，避免大面积断链。

## Phase 1：把拼好鼠导入模块统一成“导入订单列表”

### 页面与路由

新增：

1. `src/app/orders/import/page.tsx`
2. `src/app/api/orders/import/template/route.ts`

保留兼容：

1. `src/app/orders/import/pingoodmice/page.tsx` 改成 redirect wrapper
2. `src/app/api/orders/import/pingoodmice/route.ts` 改成 compat wrapper

页面改动要求：

1. 页面标题改为“导入订单列表”。
2. 增加 `source` 选择器，首期支持：
   - `PINGOODMICE`
   - `OTHER_IMPORT`
3. 文案统一从“拼好鼠导入”改为“订单导入”或“导入订单列表”。
4. `src/app/orders/page.tsx` 顶部按钮改为“导入订单列表”。
5. `src/app/external-orders/page.tsx` 保持 redirect，但目标改为 `/orders?source=PINGOODMICE` 或 `/orders/import?source=PINGOODMICE`，看页面职责决定。

### 模版下载

新增静态模版与模板常量：

1. `public/templates/order-import-template.csv`
2. `src/lib/orders/import-template.ts`

模板表头以当前可识别表头为准，至少包含：

1. `所属平台`
2. `订单号`
3. `商户单号`
4. `所属门店`
5. `全部商品名称`
6. `商品总件数`
7. `商品种类数`
8. `下单时间`
9. `付款时间`
10. `收件人`
11. `收件人电话`
12. `收件人地址`
13. `下单用户`
14. `商品总额`
15. `订单改价`
16. `订单实付金额`
17. `运费`
18. `卖家留言`
19. `商家备注`
20. `备注/表单`

要求：

1. 模版下载按钮放在新导入页。
2. 模版首行给一个示例数据，避免客户不知道格式。
3. 下载文件名用 `order-import-template.csv`，不要带渠道名。

### 命名重构边界

必须改名：

1. `PingoodmiceImportPage` -> `OrderImportPage`
2. 页面内 state/handler 命名里的 `pingoodmice` 前缀
3. 新 helper 统一用 `order import` / `source order import`

暂不强制改名：

1. `Order.source = "PINGOODMICE"`
2. 老数据中的 source 值
3. 历史迁移脚本文件名

## Phase 2：外部订单导入时支持联动导入客户和机构

### 产品决策

首期不做“导入即无条件自动建客户”。

采用三档模式：

1. `customerMode = MATCH_ONLY`
2. `customerMode = CREATE_IF_MISSING`
3. `customerMode = SKIP`

机构也采用三档：

1. `organizationMode = RESOLVE_ONLY`
2. `organizationMode = CREATE_IF_MISSING`
3. `organizationMode = SKIP`

推荐默认值：

1. `customerMode = MATCH_ONLY`
2. `organizationMode = RESOLVE_ONLY`

### 提交接口

新增提交接口：

`POST /api/orders/import/commit`

建议 body：

```ts
{
  source: "PINGOODMICE" | "OTHER_IMPORT";
  rawText?: string;
  batchId?: string;
  rows?: NormalizedImportRow[];
  customerMode: "MATCH_ONLY" | "CREATE_IF_MISSING" | "SKIP";
  organizationMode: "RESOLVE_ONLY" | "CREATE_IF_MISSING" | "SKIP";
  createCrmProfileForNewCustomer?: boolean;
  ownerUserId?: string | null;
}
```

规则：

1. `ownerUserId` 只有 ADMIN 可传。
2. `createCrmProfileForNewCustomer = true` 时必须有 `ownerUserId`。
3. 如果 `customerMode = CREATE_IF_MISSING` 且创建了新客户：
   - 可选创建 `CrmCustomerProfile`
   - 不强制默认创建，避免把脏数据直接塞进 CRM

### 机构导入逻辑

必须复用现有 helper，不要另写一套：

1. `resolveOrganization()`
2. `ensureOrganizationFromInput()`
3. `normalizeOrgName()`

导入逻辑：

1. 有 `buyerOrgNameSnapshot/storeName` 时先 `resolveOrganization()`。
2. exact/alias 命中则直接绑定 `organizationId`。
3. 未命中时：
   - `organizationMode = RESOLVE_ONLY`：只保留快照文本，不新建机构。
   - `organizationMode = CREATE_IF_MISSING`：调用 `ensureOrganizationFromInput()` 创建机构。
4. 如果机构文本为空，不创建机构，只保留订单快照。

### 客户导入逻辑

必须复用现有 helper，不要重新发号或新写匹配逻辑：

1. `generateCustomerCode()`
2. `matchSourceOrders()` 中的既有匹配规则可拆成共享函数

建议新增 helper：

`resolveOrCreateCustomerForImport(input): Promise<{ customerId: string | null; created: boolean; matchStatus: string; reason: string | null }>`

优先级：

1. 先走现有匹配规则：
   - wechat
   - phone in principal
   - name + organization
   - name + address
2. 有高置信命中则直接绑定 `customerId`
3. 无命中且 `customerMode = CREATE_IF_MISSING` 时创建新客户

新客户创建字段建议：

1. `Customer.name` <- `buyerNameSnapshot`
2. `Customer.principal` <- `buyerPhoneSnapshot`
3. `Customer.wechat` <- `buyerWechatSnapshot`
4. `Customer.organization` <- 解析后的 canonicalName 或原始文本
5. `Customer.organizationId` <- 解析/新建出的 organizationId
6. `Customer.address` <- `buyerAddressSnapshot`
7. `Customer.organizationRawInput` <- 原始机构文本

如果创建 CRM profile：

1. `ownerUserId` <- body.ownerUserId
2. `stage = "NEW"`
3. `importance = "NORMAL"`
4. `assignmentStatus = "ASSIGNED"`

### 事务边界

每一行导入必须用单行事务：

1. 机构创建
2. 客户创建
3. CRM profile 创建
4. Order 创建/更新
5. OrderSourceRecord 创建
6. OrderLine 创建

原则：

1. 同一行任何一步失败，不留下半成品客户或机构。
2. 多行之间互不影响，单行失败写入 `errors`。

## Phase 3：为外部订单导入增加 AI 兼容层

### 目标

解决客户上传“列很多、表头不标准、混合说明列、非拼好鼠格式”的问题。

AI 层不是直接落库，而是把原始表转成系统内部标准表，再走 preview/commit。

### 首期技术边界

首期支持输入：

1. `.csv`
2. `.tsv`
3. `.txt`
4. `.xlsx`

为此新增依赖：

1. `xlsx` 或 `exceljs`

推荐使用 `xlsx`，因为这里更偏读取和二维表转换。

### 导入流程

推荐拆成三步：

1. `preview`
2. `ai-normalize`
3. `commit`

#### `POST /api/orders/import/preview`

职责：

1. 解析上传文件
2. 检测分隔符/工作表/列数/表头命中率
3. 返回原始列信息与是否建议走 AI 标准化

返回建议包含：

```ts
{
  format: {...};
  rawColumns: string[];
  rowCount: number;
  directImportable: boolean;
  suggestedMode: "DIRECT" | "AI_NORMALIZE";
  previewRows: Array<Record<string, string>>;
}
```

#### `POST /api/orders/import/ai-normalize`

职责：

1. 对原始宽表做 header mapping 与字段标准化
2. 输出系统标准列
3. 不直接落库

推荐 AI 输出标准列：

1. `source`
2. `platform`
3. `externalOrderNo`
4. `merchantOrderNo`
5. `buyerName`
6. `buyerPhone`
7. `buyerWechat`
8. `buyerOrgName`
9. `buyerAddress`
10. `productNamesRaw`
11. `itemCount`
12. `orderAt`
13. `paidAt`
14. `grossAmount`
15. `priceAdjustment`
16. `paidAmount`
17. `shippingFee`
18. `sellerMessage`
19. `merchantRemark`
20. `rawExtraJson`

要求：

1. AI 只负责把乱表映射成标准列，不负责编造业务字段。
2. 生成的标准化结果要回前端 preview，用户确认后再 commit。
3. 对无法判断的列放入 `rawExtraJson`，不要丢数据。

### 列数上限与分块策略

为了避免客户上传超宽表，增加以下限制：

1. `ORDER_IMPORT_MAX_COLUMNS = 40`
2. `ORDER_IMPORT_AI_CHUNK_COLUMNS = 20`
3. `ORDER_IMPORT_MAX_ROWS_PER_AI_CHUNK = 200`
4. `ORDER_IMPORT_MAX_CELLS_PER_REQUEST = 6000`

规则：

1. 如果列数 <= 40，允许单次直接 preview / AI normalize。
2. 如果列数 > 40：
   - 先按列分块
   - 每块保留表头
   - AI 先做“列映射建议”
   - 本地再把多个 chunk 合并成统一标准列
3. 任何 chunk 都必须保留关键列：
   - 订单号
   - 姓名
   - 电话
   - 单位
   - 金额
4. 如果上传文件行数过大，按 200 行分页 preview，不一次把全量表发给 AI。

### AI Provider

优先复用当前仓库已有 AI 能力，不要新接一套：

1. 现有 `draft` provider 抽象
2. 现有 MiniMax/Tavily 能力

建议新增：

1. `src/lib/orders/import-ai.ts`
2. 单独 prompt，明确只做“表头识别、字段映射、数据清洗”

### 审计与追溯

建议新增 `OrderImportBatch`，不要继续复用 legacy `ExternalOrderImportBatch`：

```prisma
model OrderImportBatch {
  id                 String   @id @default(cuid())
  source             String
  importMode         String   // DIRECT | AI_NORMALIZED
  status             String   @default("PREVIEWED") // PREVIEWED | NORMALIZED | IMPORTED | FAILED
  originalFilename   String?
  originalMimeType   String?
  rawText            String?
  rawPreviewJson     String?
  normalizedJson     String?
  formatJson         String?
  warningJson        String?
  createdById        String
  createdBy          User     @relation(fields: [createdById], references: [id], onDelete: Cascade)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

要求：

1. `OrderSourceRecord.importBatchId` 继续存 batch id。
2. 首期可以先不把它做成 Prisma relation，避免碰 legacy `importBatchId` 兼容。

## Phase 4：增加客户垫付与垫付退款

### 为什么不能直接塞进 `FinanceReceipt`

原因：

1. 垫付不是最终营收。
2. 垫付退款也不是负回款。
3. 如果直接写进 `FinanceReceipt`，会污染“已回款”“未回款”“利润”口径。

### 新模型

新增：

```prisma
model FinanceAdvance {
  id            String    @id @default(cuid())
  customerId    String?
  customer      Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
  orderId       String?
  order         Order?    @relation(fields: [orderId], references: [id], onDelete: SetNull)
  projectId     String?
  project       Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)
  amount        Float
  advancedAt    DateTime  @default(now())
  status        String    @default("HELD") // HELD | PARTIAL_REFUNDED | REFUNDED | WRITTEN_OFF
  settledByReceiptId String?
  settledByReceipt   FinanceReceipt? @relation("AdvanceSettledByReceipt", fields: [settledByReceiptId], references: [id], onDelete: SetNull)
  remark        String?
  createdById   String
  createdBy     User      @relation(fields: [createdById], references: [id], onDelete: Cascade)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  refunds       FinanceAdvanceRefund[]

  @@index([customerId])
  @@index([orderId])
  @@index([projectId])
  @@index([status])
}

model FinanceAdvanceRefund {
  id           String         @id @default(cuid())
  advanceId    String
  advance      FinanceAdvance @relation(fields: [advanceId], references: [id], onDelete: Cascade)
  amount       Float
  refundedAt   DateTime       @default(now())
  remark       String?
  createdById  String
  createdBy    User           @relation(fields: [createdById], references: [id], onDelete: Cascade)
  createdAt    DateTime       @default(now())

  @@index([advanceId])
}
```

说明：

1. `FinanceReceipt` 不增加负金额退款逻辑。
2. 真正对公到款仍然走 `FinanceReceipt`。
3. 客户垫付与退款单独在 `FinanceAdvance` 体系中统计。

### API

新增：

1. `GET /api/finance/advances`
2. `POST /api/finance/advances`
3. `POST /api/finance/advances/[id]/refund`
4. `GET /api/finance/advances/[id]`

规则：

1. 只有 `ADMIN` / `USER` 能写。
2. `REPRESENTATIVE` 继续不能进财务 CRUD。
3. refund 金额累计不能超过 advance 原金额。
4. `status` 自动从 `HELD` -> `PARTIAL_REFUNDED` -> `REFUNDED`。

### 页面

首期放 3 个入口：

1. `src/app/orders/[id]/page.tsx`
   - finance tab 增加“客户垫付”卡片
   - 可新增垫付、退款
2. `src/app/finance/customers/[customerId]/page.tsx`
   - 增加“垫付”tab 或 section
3. `src/app/finance/page.tsx`
   - 增加“垫付余额”摘要卡

财务计算要求：

1. 垫付不计入 `totalReceiptAmount`
2. 垫付退款不计入成本
3. 可新增：
   - `advanceHeldAmount`
   - `advanceRefundedAmount`

## Phase 5：代表看到自己客户的订单，并显示开票/回款状态

### 权限口径修改

关键文件：

1. `src/lib/orders/permissions.ts`
2. `src/app/api/orders/route.ts`
3. `src/app/api/orders/[id]/route.ts`

当前问题：

1. 代表订单权限主要靠项目链路。
2. “自己客户的未立项订单”可能看不到。

改造目标：

1. `REPRESENTATIVE` 可以看到：
   - 自己名下 CRM 客户的订单
   - 自己代表项目关联的订单
2. `REGIONAL_MANAGER` 可以看到：
   - 自己 + 下辖代表名下 CRM 客户的订单
   - 自己 + 下辖代表项目关联的订单

实现方式：

1. 在 `getOrderScopeWhere()` 中把 CRM customer scope 并入 representative scope。
2. 不要替换掉现有 project-linked scope，要做 OR 合并。

建议新 helper：

`getRepresentativeVisibleCustomerIds(userId, role): Promise<string[]>`

数据来源：

1. `CrmCustomerProfile.ownerUserId`
2. `CrmRegionManagerRepresentative`

### 订单列表/详情返回更多财务摘要

`/api/orders` 和 `/api/orders/[id]` 增加计算字段：

1. `invoiceStatus`
2. `receiptTotal`
3. `unpaidAmount`
4. `paymentStatus`：`UNPAID | PARTIAL | PAID`

规则：

1. `invoiceStatus` 基于有效 `invoiceRequests/orderCoverage`
2. `receiptTotal` = 该订单关联 `FinanceReceipt.amount` 聚合
3. `paymentStatus` 由 `receiptTotal` 和 order financial amount 推导
4. 不新增手工布尔字段

### 代表详情页增加订单 tab

关键文件：

1. `src/app/api/crm/representatives/[representativeId]/route.ts`
2. `src/app/crm/representatives/[representativeId]/page.tsx`

改动：

1. 返回该代表名下客户的订单列表
2. 新增“订单”tab
3. 每行展示：
   - 订单号
   - 客户
   - 金额
   - 开票状态
   - 回款状态
   - 最近下单时间
4. 点击跳到 `/orders/[id]`

### 订单页代表视图

关键文件：

1. `src/app/orders/page.tsx`
2. `src/app/orders/[id]/page.tsx`

改动：

1. 代表角色可进入 `/orders`
2. 页面只读，不显示 admin 才能做的编辑/开票/成本/绑定按钮
3. 列表和详情页增加：
   - 开票 badge
   - 回款 badge
   - 未回款金额

### 财务权限不放开

必须保持：

1. `src/lib/finance/permissions.ts` 里代表仍 blocked
2. 代表只通过订单/CRM 读到财务摘要，不直接进入财务工作台

## Phase 6：开票申请后上传真实发票，并明确“已回款”

### 新模型

建议新增一个统一附件模型，不要把文件字段硬塞到两个 invoice 表里：

```prisma
model InvoiceDocument {
  id                            String                       @id @default(cuid())
  projectInvoiceId              String?
  projectInvoice                ProjectInvoice?              @relation(fields: [projectInvoiceId], references: [id], onDelete: Cascade)
  externalOrderInvoiceRequestId String?
  externalOrderInvoiceRequest   ExternalOrderInvoiceRequest? @relation(fields: [externalOrderInvoiceRequestId], references: [id], onDelete: Cascade)
  kind                          String                       @default("ACTUAL_INVOICE") // ACTUAL_INVOICE | RED_INVOICE | OTHER
  fileName                      String
  fileUrl                       String
  fileSize                      Int
  mimeType                      String
  uploadedById                  String
  uploadedBy                    User                         @relation(fields: [uploadedById], references: [id], onDelete: Cascade)
  createdAt                     DateTime                     @default(now())

  @@index([projectInvoiceId])
  @@index([externalOrderInvoiceRequestId])
}
```

同时给两类 invoice 增加真实发票信息：

1. `actualInvoiceNo String?`
2. `actualIssuedAt DateTime?`

说明：

1. 上传真实发票成功时，如果当前 invoice.status = `REQUESTED`，可自动推进到 `ISSUED`
2. 如果已经是 `ISSUED`，只补充附件和票号

### 上传接口

新增：

1. `POST /api/finance/invoice-documents`
2. `DELETE /api/finance/invoice-documents/[id]`

建议 payload：

1. `projectInvoiceId` 或 `externalOrderInvoiceRequestId`
2. `file`
3. `actualInvoiceNo`
4. `actualIssuedAt`

文件存储可以仿照：

1. `src/app/api/projects/[id]/attachments/route.ts`
2. `src/app/api/crm/upload/route.ts`

建议目录：

1. `public/uploads/invoices/project/{invoiceId}/`
2. `public/uploads/invoices/order/{invoiceId}/`

### 发票 UI

关键文件：

1. `src/components/invoice-form-dialog.tsx`
2. `src/app/finance/invoices/page.tsx`
3. `src/app/finance/order-matching/page.tsx`
4. `src/app/finance/project-invoices/page.tsx`
5. `src/app/orders/[id]/page.tsx`

改动：

1. invoice card/detail 上增加“上传真实发票”按钮
2. 已上传时显示：
   - 真实发票号
   - 开票日期
   - 附件列表
3. 支持重复上传多文件
4. 支持删除错误上传

### “已回款”按钮与状态

产品上不要做一个单独的“已回款=true/false”开关。

正确做法：

1. invoice 列表返回：
   - `receiptTotal`
   - `outstandingAmount`
   - `paymentStatus`
2. 当 `paymentStatus !== PAID` 时显示“登记回款”按钮
3. 当 `paymentStatus === PAID` 时显示“已回款” badge

涉及接口：

1. `/api/finance/order-invoices`
2. `/api/finance/project-invoices`
3. `/api/finance/invoice-status`

计算规则：

1. 项目发票的回款总额聚合 `FinanceReceipt.projectInvoiceId = invoice.id`
2. 订单发票的回款总额聚合 `FinanceReceipt.externalOrderInvoiceRequestId = invoice.id`
3. `paymentStatus`：
   - `UNPAID`
   - `PARTIAL`
   - `PAID`

## Schema 清单

`prisma/schema.prisma` 预计新增：

1. `OrderImportBatch`
2. `FinanceAdvance`
3. `FinanceAdvanceRefund`
4. `InvoiceDocument`
5. `ProjectInvoice.actualInvoiceNo`
6. `ProjectInvoice.actualIssuedAt`
7. `ExternalOrderInvoiceRequest.actualInvoiceNo`
8. `ExternalOrderInvoiceRequest.actualIssuedAt`
9. `FinanceAdvance.settledByReceiptId` 可选

说明：

1. 本轮不建议改 `OrderSourceRecord.importBatchId` 的历史字段名。
2. 本轮不建议改 `ExternalOrderImportBatch`，避免 legacy 迁移混淆。

## 建议文件改动清单

### 订单导入

1. `src/app/orders/import/page.tsx`
2. `src/app/orders/import/pingoodmice/page.tsx`
3. `src/app/api/orders/import/preview/route.ts`
4. `src/app/api/orders/import/ai-normalize/route.ts`
5. `src/app/api/orders/import/commit/route.ts`
6. `src/app/api/orders/import/pingoodmice/route.ts`
7. `src/app/api/orders/import/template/route.ts`
8. `src/app/orders/page.tsx`
9. `src/lib/orders/import-parser.ts`
10. `src/lib/orders/import-template.ts`
11. `src/lib/orders/import-masterdata.ts`
12. `src/lib/orders/import-ai.ts`
13. `src/lib/orders/import-commit.ts`
14. `src/lib/orders/source-order-match.ts`
15. `public/templates/order-import-template.csv`

### 客户/机构联动

1. `src/lib/organizations/ensure-organization.ts`
2. `src/lib/organization-resolver.ts`
3. `src/lib/customer-code.ts`
4. `src/lib/business/customer-context.ts`

### 垫付/退款

1. `src/app/api/finance/advances/route.ts`
2. `src/app/api/finance/advances/[id]/refund/route.ts`
3. `src/components/finance/advance-form-dialog.tsx`
4. `src/components/finance/advance-refund-dialog.tsx`
5. `src/app/finance/customers/[customerId]/page.tsx`
6. `src/app/orders/[id]/page.tsx`
7. `src/app/finance/page.tsx`
8. `src/lib/finance/calculations.ts`
9. `src/lib/finance/types.ts`

### 代表订单视图

1. `src/lib/orders/permissions.ts`
2. `src/app/api/orders/route.ts`
3. `src/app/api/orders/[id]/route.ts`
4. `src/app/api/crm/representatives/[representativeId]/route.ts`
5. `src/app/crm/representatives/[representativeId]/page.tsx`
6. `src/app/orders/page.tsx`
7. `src/app/orders/[id]/page.tsx`

### 真实发票上传

1. `src/app/api/finance/invoice-documents/route.ts`
2. `src/app/api/finance/invoice-documents/[id]/route.ts`
3. `src/components/invoice-form-dialog.tsx`
4. `src/components/finance/invoice-document-upload.tsx`
5. `src/app/finance/invoices/page.tsx`
6. `src/app/finance/order-matching/page.tsx`
7. `src/app/finance/project-invoices/page.tsx`
8. `src/app/api/finance/order-invoices/route.ts`
9. `src/app/api/finance/project-invoices/route.ts`
10. `src/app/api/finance/invoice-status/route.ts`

## DeepSeek 执行顺序

建议严格按下面顺序做，避免前后返工：

1. 先做 schema 设计并 `npx prisma db push`
2. 做通用订单导入入口与模板下载
3. 把旧拼好鼠导入逻辑迁到 preview/commit 架构
4. 做客户/机构联动导入
5. 做 AI 兼容层和列分块
6. 做垫付/退款模型与 API
7. 做代表订单权限与代表页订单 tab
8. 做真实发票上传与 invoice paymentStatus 聚合
9. 最后统一清理命名、按钮文案、兼容 redirect/proxy

## 验证清单

### 导入

1. `/orders/import` 可用，标题为“导入订单列表”
2. 模板可下载
3. 旧 `/orders/import/pingoodmice` 仍可进入
4. 旧 `/api/orders/import/pingoodmice` 仍可用
5. `PINGOODMICE` 文件正常预览与导入
6. `OTHER_IMPORT` 文件可通过 AI 标准化后导入
7. 超宽表会触发分块，不会直接报 token/内存错误

### 主数据

1. `MATCH_ONLY` 时不新建客户/机构
2. `CREATE_IF_MISSING` 时可新建机构
3. `CREATE_IF_MISSING` 时可新建客户
4. 可选创建 CRM profile 且 owner 正确
5. 导入失败不会留下半成品 customer/org/profile

### 垫付

1. 新增垫付后，不影响回款统计
2. 登记退款后，余额正确减少
3. refund 金额不能超过 advance 原金额
4. 财务首页可看到垫付余额

### 代表视图

1. 代表可看到自己客户的订单，即使未立项
2. 区域经理可看到下辖代表客户订单
3. 代表详情页有“订单”tab
4. 代表能看到开票/回款状态，但不能做财务写操作

### 真实发票

1. 发票申请后可上传真实发票文件
2. 上传后可展示票号、开票日期、附件
3. invoice `REQUESTED -> ISSUED` 自动推进正常
4. 若有回款，invoice 能正确显示 `PAID/PARTIAL/UNPAID`
5. “已回款”由回款事实推导，不是手工按钮状态

## 默认假设

如果产品没有额外澄清，DeepSeek 按以下默认值实现：

1. 导入客户默认不自动创建 CRM profile。
2. 只有 ADMIN 可以在导入时指定 `ownerUserId`。
3. AI 层默认只在 preview 判断“直导不可靠”时触发，不对所有文件强制走 AI。
4. 垫付与退款单独建模，不复用 `FinanceReceipt`。
5. 代表不开放财务页面，只开放订单/CRM 中的只读财务状态。
6. 真实发票上传后，如果没有票号也允许先存附件，但 UI 要提醒补全票号。
