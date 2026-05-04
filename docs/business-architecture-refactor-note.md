# Note: 订单-项目-财务-CRM-员工管理整体重构讨论稿

## 状态

本文档是业务架构讨论稿，不是立即实施 spec。

目标是先固定系统边界、核心口径和重构顺序，避免后续在订单、项目、财务、CRM、员工绩效之间反复出现重复计算、入口分散和权限归属不清的问题。

## 当前核心结论

建议按照下面的业务事实分层：

`订单 = 商业事实`

`项目 = 交付事实`

`财务 = 结算事实`

`CRM = 客户经营事实`

`员工管理 = 绩效与组织管理事实`

一句话：

系统后续应以订单作为统一商业入口，以项目承接交付流程，以财务统一计算应收、开票、到款和利润，以 CRM 维护客户关系和经营活动，以员工管理读取订单、项目、财务、CRM 的标准汇总结果。

## 目标导航结构

### 1. 订单管理

订单管理应成为所有商业订单的统一入口。

包含：

1. 新建服务订单
2. 拼好鼠订单导入
3. 拼好鼠订单匹配
4. 订单合流、去重、合并
5. 订单关联客户
6. 订单关联项目
7. 订单财务分类
8. 订单是否独立计入或并入项目

重要调整：

`/external-orders` 不应继续作为独立业务入口存在。它后续应并入订单管理模块，作为“拼好鼠订单来源/导入记录/原始订单视图”的一部分。

也就是说：

`主动创建服务订单 + 拼好鼠导入订单 -> 统一订单模块 -> 关联客户/项目/财务`

而不是：

`服务订单一套逻辑，拼好鼠订单一套逻辑，财务再做二次合并`

### 2. 项目管理

项目管理负责交付流程，不直接拥有订单金额口径。

包含：

1. 项目进度管理
2. 项目状态变更
3. 项目更新提醒
4. 工单或任务流
5. 项目完成/结项
6. 项目交付信息

项目可以：

1. 从订单生成
2. 绑定一个或多个订单
3. 独立创建，不绑定订单

不建议为了早期接触强行创建 0 元伪订单。更合适的做法是允许项目草稿、CRM 机会或未关联订单的项目存在。

### 3. 财务管理

财务管理负责统一结算口径。

包含：

1. 计算进度款
2. 开票申请
3. 计算应收账款
4. 记录到款
5. 现金流统计
6. 成本录入
7. 利润率计算
8. 已开票未付款
9. 未开票项目
10. 拼好鼠订单开票
11. 标准项目开票

财务模块不应该再让项目页或外部订单页分散处理开票 CRUD。项目管理和订单管理可以展示摘要，并跳转到财务模块处理。

### 4. CRM 管理

CRM 管理继续维护客户经营状态。

包含：

1. 客户资料
2. 客户关系
3. 跟进任务
4. 沟通记录
5. 拜访打卡
6. 单位主数据
7. 客户申请
8. 客户地图和关系网络

CRM 可以读取订单、项目、财务的聚合摘要，例如：

1. 客户订单总额
2. 客户项目总额
3. 客户应收
4. 客户回款
5. 客户利润率
6. 客户最近项目
7. 客户最近订单

但 CRM 不应该成为金额计算的权威来源。

### 5. 员工管理

员工管理后续用于代表和管理人员的经营统计与绩效。

包含：

1. 代表订单立项情况
2. 代表进度款情况
3. 代表开票情况
4. 代表回款情况
5. 代表 CRM 活跃度
6. 区域经理或管理代表的团队统计
7. 绩效规则预留

员工管理应读取标准汇总层，不应直接从多个页面 API 拼装口径。

## 核心业务关系

### 订单与项目

推荐关系：

`Order <-> Project` 使用关联表，而不是简单的一对一字段。

原因是实际业务会出现：

1. 一个订单生成一个项目
2. 一个订单拆成多个项目
3. 多个拼好鼠订单合并到一个项目
4. 一个项目追加多个订单
5. 订单只作为商品销售，不生成项目
6. 项目先行创建，后续再补订单

关联表建议表达：

1. 订单和项目的绑定关系
2. 本次绑定计入项目的金额
3. 是否独立计入
4. 是否并入项目
5. 是否排除
6. 人工备注

这样才能解决“拼好鼠订单绑定项目后以项目为准，只算一遍费用”的问题。

### 项目完成与订单交付

默认规则：

1. 服务类项目完成，视为订单交付
2. 商品类订单下单或确认后，视为完成交付
3. 项目完成可以触发财务进度款的 70% 尾款

但必须保留人工覆盖：

1. 手动设置交付日期
2. 手动确认是否计入应收
3. 部分交付
4. 项目完成但暂不触发财务

否则后续遇到延期付款、部分样本完成、客户暂缓结算等情况会很难处理。

### 财务计算口径

需要明确区分下面几类金额：

1. 订单金额：商业成交金额
2. 项目预算金额：交付管理中的项目金额
3. 有效业务额：去重后的业务金额
4. 进度款：按项目/订单状态计算的阶段性应收
5. 应收金额：客户当前应付款
6. 已开票金额：已经申请或开具的发票金额
7. 已到款金额：实际回款金额
8. 未开票金额：应收金额减已开票金额
9. 未到款金额：应收金额或开票金额减已到款金额，需按视图明确口径
10. 成本金额：项目或订单成本
11. 利润金额：收入或回款减成本
12. 利润率：利润除以对应收入口径

默认建议：

1. 服务项目未完成：计 30% 进度款
2. 服务项目完成：计 100% 进度款
3. 服务项目本期完成：本期新增 70% 进度款
4. 商品订单：计 100% 进度款
5. 绑定到项目且设为并入项目的订单：订单金额仅展示，不重复计入有效业务额
6. 独立订单：直接计入有效业务额和应收

### 开票与到款

开票和回款应统一放在财务模块处理。

项目管理中只保留：

1. 开票摘要
2. 已开票金额
3. 已到款金额
4. 跳转财务处理

订单管理中只保留：

1. 订单是否已开票
2. 订单是否已到款
3. 跳转财务处理

财务模块需要支持：

1. 单项目多张发票
2. 多订单合并开票
3. 发票金额大于项目金额
4. 发票金额低于项目金额
5. 一张回款对应一张发票
6. 一笔回款拆分到多张发票
7. 回款直接挂项目或订单
8. 后续人工对账

## 模块边界建议

### 订单管理拥有

1. 订单创建
2. 订单导入
3. 订单合并
4. 订单去重
5. 订单客户匹配
6. 订单项目绑定
7. 订单来源
8. 订单财务分类
9. 订单原始字段

### 项目管理拥有

1. 项目基本信息
2. 项目状态
3. 项目进度
4. 项目交付
5. 项目成员
6. 工单和提醒
7. 项目附件和活动记录

### 财务管理拥有

1. 应收规则
2. 进度款计算
3. 开票申请
4. 到款记录
5. 成本记录
6. 利润计算
7. 财务看板
8. 财务口径导出

### CRM 拥有

1. 客户经营状态
2. 客户 owner
3. 客户关系网络
4. 跟进任务
5. 沟通记录
6. 拜访签到
7. 客户地址和画像补充

### 员工管理拥有

1. 员工/代表视图
2. 团队视图
3. 订单贡献统计
4. 进度款贡献统计
5. 回款贡献统计
6. CRM 活跃度统计
7. 绩效规则配置和快照

## 建议重构顺序

### Phase 1: 订单入口统一

目标：

把主动服务订单和拼好鼠订单统一到订单模块。

重点：

1. 新增或重构订单管理导航
2. `/external-orders` 并入订单模块
3. 保留拼好鼠原始导入记录
4. 统一客户匹配和项目绑定入口
5. 统一订单财务分类
6. 明确订单列表和订单详情的信息结构

## 统一订单模型长期方案

详细模型设计见：

`docs/unified-order-model-spec.md`

订单页面、API、状态流和旧入口退场设计见：

`docs/order-workflow-spec.md`

订单、项目、财务之间的去重和金额计算口径见：

`docs/order-project-finance-calculation-spec.md`

从 ExternalOrder 迁移到统一 Order 的方案见：

`docs/order-migration-compatibility-spec.md`

项目模块作为交付事实的重构蓝图见：

`docs/project-module-refactor-blueprint.md`

财务模块作为结算与核算事实的重构蓝图见：

`docs/finance-module-refactor-blueprint.md`

给 DeepSeek 的执行拆分、PR 顺序和 review 节点见：

`docs/refactor-execution-instructions.md`

### 当前倾向

趁当前系统数据量还不大，建议直接采用长期方案：

`新建统一 Order 体系，而不是继续扩展 ExternalOrder`

也就是说，`ExternalOrder` 不再作为业务订单主表，而是迁移为“外部来源导入记录”或被 `OrderSourceRecord` 替代。

最终业务主线应变成：

`主动服务订单 / 拼好鼠导入订单 / 其他来源订单 -> Order -> OrderProjectLink -> Project / Finance`

### 核心模型

建议新增下面几类模型：

1. `Order`：统一订单主表，代表商业事实
2. `OrderLine`：订单明细，支持商品/服务混合
3. `OrderSourceRecord`：来源记录，保存拼好鼠 CSV 原始字段、rawJson 和导入批次
4. `OrderProjectLink`：订单与项目的关联、分摊、计入口径
5. `OrderStatusHistory`：订单状态审计
6. `OrderMerge`：订单合并审计

### Order 主表建议字段

`Order` 应表达订单的稳定商业字段：

1. `orderNo`：系统内部订单号，唯一
2. `source`：订单来源，例如 `MANUAL`、`PINGOODMICE`、`OTHER_IMPORT`
3. `sourcePlatform`：来源平台
4. `externalOrderNo`：外部订单号
5. `merchantOrderNo`：商户订单号
6. `title`：订单标题
7. `description`：订单备注
8. `category`：订单分类，`SERVICE`、`PRODUCT`、`MIXED`、`UNKNOWN`
9. `status`：订单状态，`DRAFT`、`CONFIRMED`、`CANCELLED`、`CLOSED`
10. `deliveryStatus`：交付状态，`PENDING`、`PARTIAL`、`DELIVERED`、`WAIVED`
11. `orderedAt`：下单时间
12. `confirmedAt`：确认时间
13. `deliveredAt`：交付时间
14. `customerId`：匹配客户
15. `buyerNameSnapshot`：下单/收件人姓名快照
16. `buyerPhoneSnapshot`：手机号快照
17. `buyerWechatSnapshot`：微信号快照
18. `buyerOrgNameSnapshot`：单位名称快照
19. `buyerAddressSnapshot`：地址快照
20. `totalAmount`：订单总金额
21. `financeAmountOverride`：人工财务金额覆盖
22. `financeTreatment`：默认财务计入口径
23. `financeNote`：财务备注
24. `ownerUserId`：订单负责人
25. `representativeId`：关联代表
26. `createdById`：创建人
27. `archived / deleted`：归档和软删除

### OrderLine 明细建议字段

`OrderLine` 应表达订单明细，避免把商品/服务混合订单压成一个金额：

1. `orderId`
2. `itemName`
3. `spec`
4. `unit`
5. `quantity`
6. `unitPrice`
7. `amount`
8. `category`：`SERVICE`、`PRODUCT`、`UNKNOWN`
9. `sortOrder`

后续财务计算时：

1. 服务类行项目可以跟项目进度联动
2. 商品类行项目默认 100% 应收
3. 混合订单可以按明细拆分计算

### OrderSourceRecord 来源记录

`OrderSourceRecord` 负责保存导入来源，不作为财务计算主表。

建议字段：

1. `orderId`
2. `importBatchId`
3. `source`
4. `platform`
5. `externalOrderNo`
6. `merchantOrderNo`
7. `rawJson`
8. `rawText`
9. `duplicateStatus`
10. `createdAt`

拼好鼠 CSV 中的原始字段，例如收件人、收件电话、地址、商品名、店铺名、下单用户等，可以保存在 `rawJson`，同时抽取到 `Order` 的稳定字段和 `OrderLine`。

### OrderProjectLink 订单项目关联

`OrderProjectLink` 是这次重构的关键。

它用于支持：

1. 一个订单生成一个项目
2. 一个订单拆成多个项目
3. 多个订单合并到一个项目
4. 一个项目追加多个订单
5. 订单绑定项目后不重复计入财务
6. 人工分摊金额

建议字段：

1. `orderId`
2. `projectId`
3. `relationType`：`GENERATED`、`LINKED`、`SPLIT`、`SUPPLEMENT`
4. `treatment`：`PROJECT_INCLUDED`、`STANDALONE`、`EXCLUDED`
5. `allocatedAmount`：本次绑定分摊金额
6. `isPrimary`：是否主项目
7. `note`

默认规则：

1. 订单绑定项目后，默认 `PROJECT_INCLUDED`
2. `PROJECT_INCLUDED` 表示订单金额展示但不重复计入，财务以项目应收为准
3. `STANDALONE` 表示订单即使有关联项目，也独立计入
4. `EXCLUDED` 表示财务排除
5. 有 `allocatedAmount` 时优先使用分摊金额

### 状态与交付

订单状态和交付状态应分开。

订单状态：

1. `DRAFT`：草稿
2. `CONFIRMED`：已确认
3. `CANCELLED`：已取消
4. `CLOSED`：已关闭

交付状态：

1. `PENDING`：未交付
2. `PARTIAL`：部分交付
3. `DELIVERED`：已交付
4. `WAIVED`：无需交付

项目完成可以联动订单交付，但不应强制不可改。

建议规则：

1. 服务订单绑定项目后，项目完成可自动把相关订单标记为已交付
2. 商品订单确认后可默认视为已交付
3. 财务人员或管理员可以手动覆盖交付状态和交付日期
4. 所有状态变更写入 `OrderStatusHistory`

### 财务计算中的 Order 口径

订单进入财务时建议遵循：

1. `Order.totalAmount` 是商业金额
2. `financeAmountOverride` 存在时作为财务有效金额
3. `OrderLine.category = PRODUCT` 默认 100% 应收
4. `OrderLine.category = SERVICE` 如果绑定项目，则按项目进度计算
5. `OrderLine.category = SERVICE` 未绑定项目时，可以按订单交付状态计算
6. `OrderProjectLink.treatment = PROJECT_INCLUDED` 时，订单不单独计入有效业务额
7. `OrderProjectLink.treatment = STANDALONE` 时，订单独立计入
8. `OrderProjectLink.treatment = EXCLUDED` 时，订单不计入

### 与现有 ExternalOrder 的迁移关系

现有 `ExternalOrder` 字段大致迁移为：

1. `source/platform/externalOrderNo/merchantOrderNo` -> `Order` 和 `OrderSourceRecord`
2. `receiverName/receiverPhone/orderUser/receiverAddress` -> `Order` 的 buyer 快照字段
3. `productNamesRaw/productNamesJson/itemCount` -> `OrderLine` 和 `OrderSourceRecord.rawJson`
4. `paidAmount/grossAmount/priceAdjustment/shippingFee` -> `Order.totalAmount` 和 rawJson
5. `customerId/customerMatchStatus/customerMatchScore/customerMatchReason` -> `Order.customerId` 和后续匹配字段
6. `projectId` -> `OrderProjectLink`
7. `financeCategory/financeTreatment/financeAmountOverride/financeNote` -> `Order` 或 `OrderLine`
8. `invoiceRequests` -> 后续统一发票关联，短期可迁移或兼容
9. `receipts` -> 改挂 `Order`
10. `mergedIntoId/duplicateStatus` -> `OrderMerge` 和 `OrderSourceRecord.duplicateStatus`

迁移完成后，`ExternalOrder` 应逐步停止作为业务主表使用。

### 初步 Prisma 草案

以下只是方向草案，不是最终 migration：

```prisma
model Order {
  id                    String   @id @default(cuid())
  orderNo               String   @unique
  source                String   @default("MANUAL")
  sourcePlatform         String?
  externalOrderNo        String?
  merchantOrderNo        String?
  title                 String
  description            String?
  category               String   @default("UNKNOWN")
  status                 String   @default("DRAFT")
  deliveryStatus         String   @default("PENDING")
  orderedAt              DateTime?
  confirmedAt            DateTime?
  deliveredAt            DateTime?
  customerId             String?
  buyerNameSnapshot      String?
  buyerPhoneSnapshot     String?
  buyerWechatSnapshot    String?
  buyerOrgNameSnapshot   String?
  buyerAddressSnapshot   String?
  totalAmount            Float    @default(0)
  financeAmountOverride  Float?
  financeTreatment       String   @default("AUTO")
  financeNote            String?
  ownerUserId            String?
  representativeId       String?
  createdById            String
  archived               Boolean  @default(false)
  deleted                Boolean  @default(false)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  lines                  OrderLine[]
  sourceRecords          OrderSourceRecord[]
  projectLinks           OrderProjectLink[]
  statusHistory          OrderStatusHistory[]

  @@index([source, externalOrderNo])
  @@index([customerId])
  @@index([status])
  @@index([category])
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

  @@index([orderId])
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
  rawJson          String?
  rawText          String?
  duplicateStatus  String   @default("UNREVIEWED")
  createdAt        DateTime @default(now())

  @@unique([source, externalOrderNo])
  @@index([orderId])
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
  createdAt        DateTime @default(now())

  @@unique([orderId, projectId])
  @@index([projectId])
}
```

### Phase 2: 订单-项目关联重构

目标：

解决订单和项目之间一对多、多对一、多对多、人工分摊的问题。

重点：

1. 引入订单项目关联层
2. 支持订单并入项目
3. 支持订单独立计入
4. 支持订单排除
5. 支持绑定金额调整
6. 项目页显示关联订单摘要
7. 订单页显示关联项目摘要

### Phase 3: 财务聚合口径重构

目标：

让财务模块成为唯一结算口径来源。

重点：

1. 统一有效业务额
2. 统一进度款
3. 统一应收
4. 统一已开票
5. 统一已到款
6. 统一未开票
7. 统一未到款
8. 统一成本和利润
9. 给 CRM 和员工管理提供稳定汇总 API

### Phase 4: 项目管理去财务化

目标：

项目管理回归交付，不再承载财务 CRUD。

重点：

1. 项目页保留财务摘要
2. 项目页保留跳转财务入口
3. 删除或隐藏项目页开票编辑能力
4. 项目完成事件对财务产生可审计影响

### Phase 5: CRM 联动增强

目标：

CRM 读取业务摘要，辅助客户经营。

重点：

1. 客户订单摘要
2. 客户项目摘要
3. 客户应收和回款摘要
4. 客户利润率摘要
5. 客户最近业务动态
6. CRM 活跃度原始事件统计

### Phase 6: 员工管理基础统计

目标：

先做事实汇总，不急着写死绩效规则。

重点：

1. 代表订单额
2. 代表项目额
3. 代表进度款
4. 代表开票额
5. 代表回款额
6. 代表未回款额
7. CRM 拜访数
8. CRM 沟通数
9. 跟进完成率
10. 绩效规则 API 预留

## 需要继续讨论的问题

### 订单模型

1. 主动服务订单是否新建独立模型，还是复用并扩展现有 `ExternalOrder`
2. 拼好鼠订单是否作为统一订单的 source 类型
3. 订单是否需要状态流，例如草稿、已确认、已取消、已交付
4. 订单金额是否允许多币种或税额拆分
5. 订单是否需要行项目明细

### 订单与项目

1. 一个订单拆多个项目时金额如何分摊
2. 多个订单合并到一个项目时项目预算以谁为准
3. 项目金额和订单金额冲突时谁是财务权威
4. 项目独立创建后是否必须后补订单
5. 早期接触应该用 CRM 机会还是项目草稿

### 财务口径

1. 应收是按进度款算，还是按开票算，还是两个口径都保留
2. 未到款是按应收减回款，还是按开票减回款
3. 利润率按订单额、应收额、开票额还是回款额计算
4. 成本录入挂订单、项目还是财务记录
5. 合并开票的回款如何分摊到订单和项目

### 权限

1. 代表是否能看订单金额
2. 代表是否能看项目利润
3. 普通 USER 是否能看财务全部字段
4. CRM owner 与订单 owner 是否需要一致
5. 员工管理中区域经理能看到哪些代表

### 员工绩效

1. 绩效以订单立项、进度款、开票还是回款为准
2. 多代表共同维护客户时如何分摊
3. 订单 owner、项目 owner、CRM owner 不一致时如何归因
4. 退款或坏账是否冲减绩效
5. 绩效是否需要按月生成快照，避免历史规则变更影响旧数据

## 当前不建议做的事

1. 不建议继续让 `/external-orders` 独立承载开票和财务动作
2. 不建议用 0 元伪订单表达所有早期项目
3. 不建议在项目管理里继续扩展开票 CRUD
4. 不建议 CRM 直接参与财务金额计算
5. 不建议员工绩效直接从页面接口临时拼数据
6. 不建议把订单和项目强行设计成一对一

## 当前推荐原则

1. 入口统一：所有订单先进入订单模块
2. 事实分层：订单、项目、财务、CRM、员工管理各自拥有自己的事实
3. 口径集中：金额计算集中在财务层
4. 关联显式：订单和项目关系用关联层表达，不靠隐含字段
5. 财务可审计：任何自动计算都要保留来源和人工覆盖能力
6. 绩效后置：先稳定业务事实，再设计绩效规则
