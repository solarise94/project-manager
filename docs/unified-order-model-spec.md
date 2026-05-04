# Spec: 统一订单模型

## 状态

本文档是统一订单模型的设计 spec 草案，目标是给后续实现 agent 提供明确的 Prisma schema、迁移边界和验收口径。

本文不要求立即实施。实现前仍需再确认页面和 API 迁移顺序。

## 背景

当前系统里的订单能力主要由 `ExternalOrder` 承载。它最初用于拼好鼠 CSV 导入，但现在已经叠加了：

1. 客户匹配
2. 项目绑定
3. 财务分类
4. 计入口径
5. 开票申请
6. 到款记录
7. 订单合并
8. 去重状态

如果继续把“主动服务订单”也塞进 `ExternalOrder`，这个模型会变成一个名称错误、职责混乱的业务主表。

因此长期方案是：

`新建统一 Order 体系`

`ExternalOrder 迁移为来源记录或逐步废弃`

## 设计目标

### 必须满足

1. 主动服务订单和拼好鼠导入订单使用同一套订单主表
2. 支持商品、服务、混合订单
3. 支持订单明细
4. 支持订单匹配客户
5. 支持订单绑定一个或多个项目
6. 支持一个项目关联一个或多个订单
7. 支持订单并入项目后不重复计入财务
8. 支持订单独立计入财务
9. 支持订单排除财务
10. 支持拼好鼠原始字段留痕
11. 支持订单合并和去重审计
12. 支持订单状态和交付状态审计
13. 支持后续员工绩效按订单归因

### 暂不处理

1. 不在本 spec 内设计完整页面交互
2. 不在本 spec 内设计绩效规则
3. 不在本 spec 内重构发票模型
4. 不在本 spec 内删除旧 `ExternalOrder`
5. 不在本 spec 内处理多币种

## 业务边界

### Order

`Order` 是商业事实主表。

它回答：

1. 客户买了什么
2. 从哪里来的订单
3. 成交金额是多少
4. 谁负责
5. 是否已经确认
6. 是否已经交付
7. 财务上如何计入

### OrderLine

`OrderLine` 是订单明细。

它回答：

1. 订单里有哪些商品或服务
2. 每项金额是多少
3. 每项是商品还是服务

### OrderSourceRecord

`OrderSourceRecord` 是导入来源记录。

它回答：

1. 这条订单来自哪个外部来源
2. 外部订单号是什么
3. 原始 CSV/JSON 数据是什么
4. 导入批次是什么
5. 是否和其他来源记录重复

它不应该成为财务计算主表。

### OrderProjectLink

`OrderProjectLink` 是订单和项目的显式关联层。

它回答：

1. 订单和哪个项目相关
2. 这次关联计入多少钱
3. 订单金额是否并入项目
4. 订单是否仍独立计入
5. 订单是否排除财务

### OrderStatusHistory

`OrderStatusHistory` 记录订单状态和交付状态变化。

### OrderMerge

`OrderMerge` 记录订单合并关系，替代只靠 `mergedIntoId` 的不可审计合并。

## 字段枚举建议

项目当前大量业务枚举使用 `String`，为减少改造冲击，本轮建议继续使用 `String` 字段，但必须在 `src/lib/orders/constants.ts` 或类似文件中集中定义常量和校验。

### OrderSource

1. `MANUAL`：手动创建订单
2. `PINGOODMICE`：拼好鼠导入订单
3. `OTHER_IMPORT`：其他外部导入

### OrderCategory

1. `SERVICE`：服务
2. `PRODUCT`：商品
3. `MIXED`：商品和服务混合
4. `UNKNOWN`：未分类

### OrderStatus

1. `DRAFT`：草稿
2. `CONFIRMED`：已确认
3. `CANCELLED`：已取消
4. `CLOSED`：已关闭

### OrderDeliveryStatus

1. `PENDING`：未交付
2. `PARTIAL`：部分交付
3. `DELIVERED`：已交付
4. `WAIVED`：无需交付

### OrderFinanceTreatment

1. `AUTO`：自动判断
2. `STANDALONE`：独立计入
3. `PROJECT_INCLUDED`：并入项目
4. `EXCLUDED`：排除

### OrderProjectRelationType

1. `GENERATED`：订单生成项目
2. `LINKED`：人工关联
3. `SPLIT`：订单拆分到项目
4. `SUPPLEMENT`：项目追加订单

### OrderMatchStatus

1. `UNMATCHED`：未匹配
2. `AUTO_MATCHED`：自动匹配
3. `MANUAL_MATCHED`：人工匹配
4. `CONFLICT`：冲突

### OrderDuplicateStatus

1. `UNREVIEWED`：未审核
2. `UNIQUE`：确认唯一
3. `DUPLICATE`：疑似重复
4. `MERGED`：已合并
5. `IGNORED`：忽略

## Prisma 模型草案

以下是建议最终方向。实现时需要根据现有 schema 的 relation 命名做完整编译校验。

```prisma
model Order {
  id                    String   @id @default(cuid())
  orderNo               String   @unique
  source                String   @default("MANUAL")
  sourcePlatform         String?
  externalOrderNo        String?
  merchantOrderNo        String?
  legacyExternalOrderId  String?  @unique

  title                 String
  description            String?
  category               String   @default("UNKNOWN")
  status                 String   @default("DRAFT")
  deliveryStatus         String   @default("PENDING")
  orderedAt              DateTime?
  confirmedAt            DateTime?
  deliveredAt            DateTime?

  customerId             String?
  customer               Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
  buyerNameSnapshot      String?
  buyerPhoneSnapshot     String?
  buyerWechatSnapshot    String?
  buyerOrgNameSnapshot   String?
  buyerAddressSnapshot   String?

  customerMatchStatus    String   @default("UNMATCHED")
  customerMatchScore     Float?
  customerMatchReason    String?

  totalAmount            Float    @default(0)
  financeAmountOverride  Float?
  financeTreatment       String   @default("AUTO")
  financeNote            String?

  ownerUserId            String?
  ownerUser              User?    @relation("OrderOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)
  representativeId       String?
  representative         Representative? @relation(fields: [representativeId], references: [id], onDelete: SetNull)
  createdById            String
  createdBy              User     @relation("OrdersCreated", fields: [createdById], references: [id], onDelete: Cascade)

  archived               Boolean  @default(false)
  deleted                Boolean  @default(false)
  deletedAt              DateTime?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  lines                  OrderLine[]
  sourceRecords          OrderSourceRecord[]
  projectLinks           OrderProjectLink[]
  statusHistory          OrderStatusHistory[]
  mergeSources           OrderMerge[] @relation("OrderMergeSource")
  mergeTargets           OrderMerge[] @relation("OrderMergeTarget")
  receipts               FinanceReceipt[]

  @@index([source, externalOrderNo])
  @@index([merchantOrderNo])
  @@index([customerId])
  @@index([ownerUserId])
  @@index([representativeId])
  @@index([status])
  @@index([deliveryStatus])
  @@index([category])
  @@index([orderedAt])
  @@index([deleted])
}

model OrderLine {
  id          String @id @default(cuid())
  orderId     String
  order       Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  itemName    String
  spec        String?
  unit        String?
  quantity    Float?
  unitPrice   Float?
  amount      Float  @default(0)
  category    String @default("UNKNOWN")
  sortOrder   Int    @default(0)
  rawJson      String?

  @@index([orderId])
  @@index([category])
}

model OrderSourceRecord {
  id              String   @id @default(cuid())
  orderId          String?
  order            Order?   @relation(fields: [orderId], references: [id], onDelete: SetNull)
  importBatchId    String?
  source           String
  platform         String?
  externalOrderNo  String
  merchantOrderNo  String?
  duplicateGroupId String?
  duplicateStatus  String   @default("UNREVIEWED")
  rawJson          String?
  rawText          String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([source, externalOrderNo])
  @@index([orderId])
  @@index([importBatchId])
  @@index([externalOrderNo])
  @@index([merchantOrderNo])
  @@index([duplicateStatus])
  @@index([duplicateGroupId])
}

model OrderProjectLink {
  id              String   @id @default(cuid())
  orderId          String
  projectId        String
  order            Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  project          Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  relationType     String   @default("LINKED")
  treatment        String   @default("PROJECT_INCLUDED")
  allocatedAmount  Float?
  isPrimary        Boolean  @default(false)
  note             String?
  createdById      String?
  createdBy        User?    @relation("OrderProjectLinksCreated", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([orderId, projectId])
  @@index([projectId])
  @@index([treatment])
  @@index([relationType])
}

model OrderStatusHistory {
  id                  String   @id @default(cuid())
  orderId              String
  order                Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  oldStatus            String?
  newStatus            String?
  oldDeliveryStatus    String?
  newDeliveryStatus    String?
  note                 String?
  createdById          String?
  createdBy            User?    @relation("OrderStatusHistoryCreated", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt            DateTime @default(now())

  @@index([orderId])
  @@index([createdAt])
}

model OrderMerge {
  id             String   @id @default(cuid())
  sourceOrderId  String
  targetOrderId  String
  sourceOrder    Order    @relation("OrderMergeSource", fields: [sourceOrderId], references: [id], onDelete: Cascade)
  targetOrder    Order    @relation("OrderMergeTarget", fields: [targetOrderId], references: [id], onDelete: Cascade)
  reason         String?
  createdById    String?
  createdBy      User?    @relation("OrderMergeCreated", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt      DateTime @default(now())

  @@unique([sourceOrderId, targetOrderId])
  @@index([targetOrderId])
}
```

## 现有模型需要新增的反向关系

### User

建议新增：

1. `ordersCreated Order[] @relation("OrdersCreated")`
2. `ordersOwned Order[] @relation("OrderOwner")`
3. `orderProjectLinksCreated OrderProjectLink[] @relation("OrderProjectLinksCreated")`
4. `orderStatusHistoryCreated OrderStatusHistory[] @relation("OrderStatusHistoryCreated")`
5. `orderMergesCreated OrderMerge[] @relation("OrderMergeCreated")`

### Customer

建议新增：

1. `orders Order[]`

后续旧字段：

1. `externalOrders ExternalOrder[]` 迁移期保留
2. 稳定后再删除

### Representative

建议新增：

1. `orders Order[]`

### Project

建议新增：

1. `orderLinks OrderProjectLink[]`

后续旧字段：

1. `externalOrders ExternalOrder[]` 迁移期保留
2. 稳定后再删除

### FinanceReceipt

建议新增：

1. `orderId String?`
2. `order Order? @relation(fields: [orderId], references: [id], onDelete: SetNull)`
3. `@@index([orderId])`

迁移期同时保留：

1. `externalOrderId`
2. `externalOrder`

稳定后再评估删除。

## 字段映射：ExternalOrder -> Order

| ExternalOrder | Order / OrderLine / OrderSourceRecord |
| --- | --- |
| `source` | `Order.source` + `OrderSourceRecord.source` |
| `platform` | `Order.sourcePlatform` + `OrderSourceRecord.platform` |
| `externalOrderNo` | `Order.externalOrderNo` + `OrderSourceRecord.externalOrderNo` |
| `merchantOrderNo` | `Order.merchantOrderNo` + `OrderSourceRecord.merchantOrderNo` |
| `id` | `Order.legacyExternalOrderId`，用于旧链接重定向和迁移追溯 |
| `storeName` | `OrderSourceRecord.rawJson`，必要时进 `buyerOrgNameSnapshot` 的辅助判断 |
| `receiverName` | `Order.buyerNameSnapshot` |
| `receiverPhone` | `Order.buyerPhoneSnapshot` |
| `receiverAddress` | `Order.buyerAddressSnapshot` |
| `orderUser` | `Order.buyerWechatSnapshot` |
| `productNamesRaw` | `OrderLine.itemName` 或 `OrderSourceRecord.rawJson` |
| `productNamesJson` | `OrderLine` 多行或 `rawJson` |
| `itemCount` | `OrderLine.quantity` 或 `rawJson` |
| `orderAt` | `Order.orderedAt` |
| `paidAt` | `Order.confirmedAt` |
| `paidAmount` | `Order.totalAmount` |
| `grossAmount` | `OrderSourceRecord.rawJson` |
| `priceAdjustment` | `OrderSourceRecord.rawJson` |
| `shippingFee` | `OrderSourceRecord.rawJson` |
| `customerId` | `Order.customerId` |
| `customerMatchStatus` | `Order.customerMatchStatus` |
| `customerMatchScore` | `Order.customerMatchScore` |
| `customerMatchReason` | `Order.customerMatchReason` |
| `projectId` | `OrderProjectLink.projectId` |
| `financeCategory` | `Order.category` 或 `OrderLine.category` |
| `financeTreatment` | `Order.financeTreatment` 或 `OrderProjectLink.treatment` |
| `financeAmountOverride` | `Order.financeAmountOverride` |
| `financeNote` | `Order.financeNote` |
| `duplicateStatus` | `OrderSourceRecord.duplicateStatus` |
| `duplicateGroupId` | `OrderSourceRecord.duplicateGroupId` |
| `mergedIntoId` | `OrderMerge` |
| `rawJson` | `OrderSourceRecord.rawJson` |

## 订单号规则

统一订单必须有内部 `orderNo`。

建议格式：

1. 手动订单：`SO-YYYYMMDD-0001`
2. 拼好鼠订单：可以生成内部号 `PO-YYYYMMDD-0001`，外部订单号仍保存在 `externalOrderNo`
3. 其他导入：`IO-YYYYMMDD-0001`

注意：

1. `externalOrderNo` 不应作为系统主订单号
2. 拼好鼠订单号只对来源唯一
3. 内部 `orderNo` 用于页面、搜索、财务和绩效引用

## 订单金额规则

### totalAmount

`Order.totalAmount` 是订单商业金额。

拼好鼠导入时：

1. 优先使用 `paidAmount`
2. 若 `paidAmount` 缺失，可用 `grossAmount + priceAdjustment + shippingFee`
3. 无法解析则为 0，并标记需要人工确认

手动订单：

1. 默认由 `OrderLine.amount` 汇总
2. 允许前端录入总金额后生成一条默认明细

### financeAmountOverride

`financeAmountOverride` 是财务有效金额覆盖。

使用原则：

1. 为空时使用 `totalAmount`
2. 有值时财务计算使用 override
3. override 必须非负
4. 修改 override 需要记录操作人和备注，至少写入活动日志或后续审计表

## 商品/服务/混合订单规则

### 订单级 category

订单级 `category` 是摘要分类。

建议自动推导：

1. 所有明细为 `PRODUCT` -> `PRODUCT`
2. 所有明细为 `SERVICE` -> `SERVICE`
3. 商品和服务都有 -> `MIXED`
4. 明细未知 -> `UNKNOWN`

### 明细级 category

财务计算优先看 `OrderLine.category`。

规则：

1. 商品明细默认 100% 应收
2. 服务明细如果绑定项目，按项目进度计算
3. 服务明细如果不绑定项目，按订单交付状态计算
4. 未分类明细不自动计入进度款，除非人工设置订单级或明细级分类

## 订单与项目关联规则

### 默认规则

1. 手动服务订单生成项目时，创建 `OrderProjectLink`
2. 拼好鼠订单绑定项目时，创建 `OrderProjectLink`
3. 一个订单可以关联多个项目
4. 一个项目可以关联多个订单

### treatment 计算

优先级：

1. `OrderProjectLink.treatment`
2. `Order.financeTreatment`
3. 自动规则

自动规则：

1. 有项目关联且订单为服务类 -> `PROJECT_INCLUDED`
2. 商品类订单 -> `STANDALONE`
3. 无项目关联 -> `STANDALONE`
4. 人工排除 -> `EXCLUDED`

### allocatedAmount

`allocatedAmount` 用于分摊金额。

规则：

1. 为空时使用订单有效金额
2. 一个订单关联多个项目时建议必须填写
3. 所有关联分摊金额之和可以小于、等于或大于订单金额，但 UI 应提示差异
4. 财务计算需要展示差异，不应静默吞掉

## 订单交付规则

### 商品订单

商品订单默认：

1. 确认后可视为 `DELIVERED`
2. 100% 计入进度款/应收

### 服务订单

服务订单默认：

1. 未绑定项目时，可按订单交付状态计算
2. 绑定项目时，项目状态是交付权威
3. 项目完成可联动订单 `deliveryStatus = DELIVERED`
4. 允许人工覆盖

### 混合订单

混合订单按明细拆分：

1. 商品明细按商品规则
2. 服务明细按服务规则

## 迁移阶段建议

### Stage 1: 加新表，不改旧流程

1. 新增 `Order` 系列表
2. 新增 `FinanceReceipt.orderId`
3. 保留旧 `ExternalOrder`
4. 跑 migration 和 Prisma client
5. 不切页面

### Stage 2: 数据迁移脚本

1. 遍历所有 `ExternalOrder`，包括已合并来源订单
2. 为每条旧 `ExternalOrder` 创建对应 `Order`
3. merged source 对应的 `Order` 标记为 `archived/deleted` 或 `EXCLUDED`，不参与财务计算
4. 创建 `OrderSourceRecord`
5. 解析 `productNamesJson` 创建 `OrderLine`
6. 根据 `projectId` 创建 `OrderProjectLink`
7. 迁移 `FinanceReceipt.externalOrderId` 到 `orderId`
8. 通过 `legacyExternalOrderId` 建立旧 id 到新 `orderId` 的映射

### Stage 3: 双写或一次性切换

由于当前数据量不大，建议避免长期双写。

推荐：

1. 维护窗口内执行迁移
2. 订单相关新写入全部写 `Order`
3. 旧 `ExternalOrder` 页面改只读或重定向
4. 拼好鼠导入直接写 `Order + OrderSourceRecord`

### Stage 4: API 切换

优先切：

1. 订单列表
2. 订单详情
3. 拼好鼠导入
4. 客户匹配
5. 项目绑定
6. 财务分类
7. 订单开票
8. 回款
9. 财务聚合

### Stage 5: 旧表退场

稳定后再评估：

1. 删除旧 `ExternalOrder` 写入口
2. 删除旧 `ExternalOrder` API
3. 删除旧 `ExternalOrder` 前端路由
4. 是否保留旧表作为审计归档

## API 影响范围

需要重构或新增：

1. `/api/orders`
2. `/api/orders/[id]`
3. `/api/orders/import/pingoodmice`
4. `/api/orders/[id]/match-customer`
5. `/api/orders/[id]/link-project`
6. `/api/orders/[id]/finance-settings`
7. `/api/orders/[id]/merge`
8. `/api/finance/summary`
9. `/api/finance/customers`
10. `/api/finance/progress-receivables`
11. `/api/finance/invoice-status`
12. `/api/finance/receipts`

旧 API：

1. `/api/external-orders/*` 迁移期保留
2. 新页面不再依赖旧 API
3. 稳定后再删除或重定向

## 页面影响范围

建议新导航：

1. `/orders`：统一订单列表
2. `/orders/new`：新建服务订单
3. `/orders/import/pingoodmice`：拼好鼠导入
4. `/orders/[id]`：订单详情
5. `/finance/order-invoices` 或继续并入 `/finance/order-matching`：订单开票

旧页面：

1. `/external-orders`：迁移期重定向到 `/orders?source=PINGOODMICE`
2. `/finance/order-matching`：后续可以改名为订单匹配与财务处理

## 权限建议

### ADMIN

1. 可见全部订单
2. 可创建、编辑、删除、合并订单
3. 可修改财务分类和计入口径
4. 可执行迁移和批量操作

### USER

1. 可见自己项目 scope 或 CRM scope 内的订单
2. 可创建手动订单
3. 可绑定自己可见项目
4. 财务敏感字段按当前财务权限控制

### REPRESENTATIVE

当前建议：

1. 不进入财务模块
2. 是否可见订单模块需单独讨论
3. 如果允许查看，只能看自己客户或项目相关订单摘要
4. 默认不显示利润、成本、财务 override

## 验收标准

### Schema

1. `prisma schema` 能通过格式化和 generate
2. 新增模型关系完整，无 Prisma relation error
3. `FinanceReceipt` 支持挂 `orderId`
4. 旧 `ExternalOrder` 迁移期仍能编译

### 数据迁移

1. 每条 `ExternalOrder` 有对应 `Order`
2. 每条 `ExternalOrder` 有对应 `OrderSourceRecord`
3. `source + externalOrderNo` 唯一性保留
4. 原 `projectId` 正确迁移为 `OrderProjectLink`
5. 原 `customerId` 正确迁移为 `Order.customerId`
6. 原财务分类和 override 正确迁移
7. 原回款能通过 `orderId` 查到
8. 已合并来源订单可追溯但不参与财务计算

### 财务口径

1. 并入项目订单不重复计入
2. 独立订单正常计入
3. 排除订单不计入
4. 商品订单 100% 应收
5. 服务订单按项目/交付状态计算
6. 混合订单按明细拆分

### 页面/API

1. 新订单列表能展示手动订单和拼好鼠订单
2. 拼好鼠导入后直接产生 `Order`
3. 客户匹配写入 `Order`
4. 项目绑定写入 `OrderProjectLink`
5. 财务看板从 `Order` 聚合
6. 旧外部订单入口不再是主业务入口

## 实施注意事项

1. 不要把新 `Order` 命名成 `UnifiedOrder`，业务层应该直接叫订单
2. 不要继续把主动服务订单塞进 `ExternalOrder`
3. 不要让 `externalOrderNo` 成为主订单号
4. 不要只用 `projectId` 表达订单项目关系
5. 不要在迁移期同时长期维护两套写入口
6. 不要在财务计算里直接读 `OrderSourceRecord.rawJson`
7. 不要把绩效规则写进订单模型
