# Spec: 统一订单迁移与兼容方案

## 状态

本文档是统一订单重构的迁移与兼容 spec 草案，承接：

1. `docs/business-architecture-refactor-note.md`
2. `docs/unified-order-model-spec.md`
3. `docs/order-workflow-spec.md`
4. `docs/order-project-finance-calculation-spec.md`

目标是明确如何从现有 `ExternalOrder` 体系迁移到统一 `Order` 体系，降低生产数据损坏、财务口径错误和旧入口断裂的风险。

本文不直接要求实现。

## 迁移原则

### 订单是新主线

迁移完成后：

1. 新订单写入 `Order`
2. 拼好鼠导入写入 `Order + OrderSourceRecord`
3. 财务聚合读取 `Order`
4. 项目绑定读取 `OrderProjectLink`
5. `/external-orders` 不再作为主业务入口

### 避免长期双写

由于当前数据量还不大，建议不要长期维护：

1. `ExternalOrder`
2. `Order`

两套写入口。

推荐策略：

1. 短维护窗口内执行迁移
2. 迁移后新写入只写 `Order`
3. 旧表保留只读一段时间
4. 验证稳定后再删除旧入口

### 保留可追溯性

即使旧 `ExternalOrder` 不再作为业务主表，也必须保留：

1. 外部订单号
2. 原始 CSV/JSON 数据
3. 导入批次
4. 合并记录
5. 发票覆盖关系
6. 回款关联

这些需要迁移到新模型或保留只读归档。

## 当前涉及旧模型

### 旧主表

1. `ExternalOrder`
2. `ExternalOrderImportBatch`
3. `ExternalOrderInvoiceRequest`
4. `ExternalOrderInvoiceItem`
5. `ExternalOrderInvoiceCoverage`

### 旧关联字段

1. `Customer.externalOrders`
2. `Project.externalOrders`
3. `FinanceReceipt.externalOrderId`
4. `FinanceReceipt.externalOrderInvoiceRequestId`
5. `User.reviewedOrders`
6. `User.externalOrderImportBatches`
7. `User.externalOrderInvoicesCreated`
8. `Organization.externalOrderInvoicesAsBuyer`
9. `BillingProfile.externalOrderInvoices`

### 需要特别关注的旧业务

1. 拼好鼠 CSV 导入
2. 按 `source + externalOrderNo` 去重
3. 客户自动匹配
4. 客户人工绑定
5. 项目绑定
6. 财务分类和计入口径
7. 合并开票
8. 订单合并
9. 回款挂外部订单
10. 财务看板聚合

## 目标新模型

核心新模型：

1. `Order`
2. `OrderLine`
3. `OrderSourceRecord`
4. `OrderProjectLink`
5. `OrderStatusHistory`
6. `OrderMerge`

迁移期新增关系：

1. `FinanceReceipt.orderId`
2. `Order.legacyExternalOrderId`
3. 后续统一订单发票模型，或短期在旧订单发票中建立 `orderId`

## 迁移总阶段

### Stage 0: 迁移前审计

目标：

先看清楚生产数据现状，避免盲迁。

需要统计：

1. `ExternalOrder` 总数
2. 未合并订单数
3. 已合并订单数
4. 有 `customerId` 的订单数
5. 有 `projectId` 的订单数
6. 有发票申请的订单数
7. 有合并开票 coverage 的订单数
8. 有回款的订单数
9. `source + externalOrderNo` 是否有异常重复
10. `paidAmount` 缺失数量
11. `financeCategory = UNKNOWN` 数量
12. `financeTreatment` 分布

建议写脚本：

`scripts/audit-external-orders-before-migration.ts`

输出：

1. 终端摘要
2. JSON 报告
3. 异常订单 CSV

### Stage 1: Schema 增量

目标：

只新增模型和字段，不切业务。

新增：

1. `Order`
2. `OrderLine`
3. `OrderSourceRecord`
4. `OrderProjectLink`
5. `OrderStatusHistory`
6. `OrderMerge`
7. `FinanceReceipt.orderId`
8. `Order.legacyExternalOrderId`

保留：

1. `ExternalOrder`
2. 旧 API
3. 旧页面
4. 旧财务计算

验证：

1. `npx prisma generate`
2. `npx prisma db push` 或 migration
3. `npm run lint`
4. `npx tsc --noEmit`
5. `npm run build`

### Stage 2: 数据迁移脚本

目标：

把旧 `ExternalOrder` 数据生成新 `Order` 数据。

建议脚本：

`scripts/migrate-external-orders-to-orders.ts`

要求：

1. 可重复运行
2. 幂等
3. 有 dry-run 模式
4. 输出迁移报告
5. 不删除旧数据

幂等策略：

1. `OrderSourceRecord.source + externalOrderNo` 唯一
2. 先查 `OrderSourceRecord`
3. 已存在则更新对应 `Order`
4. 不重复创建 `Order`

### Stage 3: 订单读 API 切换

目标：

先让新订单页面读 `Order`，但旧页面仍可用。

新增：

1. `GET /api/orders`
2. `GET /api/orders/[id]`

不立刻删除：

1. `GET /api/external-orders`
2. `GET /api/external-orders/[id]`

验证：

1. 新 `/orders` 列表能看到迁移后的拼好鼠订单
2. 搜索外部订单号能命中
3. 客户和项目关联正确显示
4. 金额和旧页面一致

### Stage 4: 新写入切换

目标：

所有新订单写入新模型。

切换：

1. 手动订单创建 -> `Order`
2. 拼好鼠导入 -> `Order + OrderSourceRecord`
3. 客户匹配 -> `Order`
4. 项目绑定 -> `OrderProjectLink`
5. 财务分类 -> `Order`

冻结：

1. 旧 `/external-orders` 写入能力
2. 旧外部订单客户绑定
3. 旧外部订单项目绑定
4. 旧外部订单财务设置

### Stage 5: 财务聚合切换

目标：

财务看板和财务 API 改读 `Order`。

切换：

1. `/api/finance/summary`
2. `/api/finance/customers`
3. `/api/finance/customers/[id]`
4. `/api/finance/progress-receivables`
5. `/api/finance/invoice-status`
6. `/api/finance/receipts`
7. `/api/finance/project-invoices`

关键验证：

1. 有效业务额不重复
2. 进度款和旧口径可解释
3. 已开票金额不丢
4. 已到款金额不丢
5. 合并开票 coverage 不丢

### Stage 6: 页面入口切换

目标：

用户入口切换到新订单模块。

处理：

1. 侧边栏显示“订单管理”
2. `/external-orders` 重定向或只读提示
3. `/finance/order-matching` 按新 `Order` 数据工作
4. `/finance` 入口指向新订单流程

### Stage 7: 旧体系退场

目标：

稳定后删除旧写路径。

可删除或归档：

1. `/app/external-orders`
2. `/api/external-orders`
3. 旧外部订单专用组件

谨慎删除：

1. 旧表
2. 旧发票表
3. 旧 coverage 表

删除旧表前必须：

1. 生产备份
2. 验证新发票模型或兼容层完整
3. 验证历史发票 PDF/飞书导出可用
4. 验证回款追溯可用

## 数据迁移细节

### 订单主表迁移

每条 `ExternalOrder` 都生成一个 `Order`，包括已合并来源订单。

原因：

1. 旧链接可以稳定重定向
2. 回款和发票迁移更容易追溯
3. `OrderMerge` 需要 sourceOrderId 和 targetOrderId
4. 审计上能看到被合并来源订单

规则：

1. `mergedIntoId = null` 的旧订单生成正常业务 `Order`
2. `mergedIntoId != null` 的旧订单也生成 `Order`
3. merged source 对应的新 `Order` 标记为 `archived = true`
4. merged source 对应的新 `Order.financeTreatment = EXCLUDED`
5. merged source 不参与有效业务额、应收、进度款
6. 创建 `OrderMerge` 记录 source -> target

### orderNo 生成

迁移脚本生成内部订单号。

建议：

1. 拼好鼠：`PO-YYYYMMDD-序号`
2. 手动：后续新建用 `SO-YYYYMMDD-序号`
3. 其他导入：`IO-YYYYMMDD-序号`

迁移时日期优先级：

1. `orderAt`
2. `paidAt`
3. `createdAt`

### title 生成

建议优先级：

1. `productNamesRaw`
2. `receiverName + "的拼好鼠订单"`
3. `externalOrderNo`

### category 迁移

映射：

1. `financeCategory = PRODUCT` -> `Order.category = PRODUCT`
2. `financeCategory = SERVICE` -> `Order.category = SERVICE`
3. 其他 -> `UNKNOWN`

如果后续有混合判断：

1. 根据 `productNamesJson` 拆分明细
2. 明细里商品和服务并存 -> `MIXED`

### status 迁移

拼好鼠已付款订单默认：

1. `Order.status = CONFIRMED`

如果旧订单有异常：

1. `duplicateStatus = MERGED` -> source 不参与业务计算
2. 被取消或测试订单 -> 可映射 `CANCELLED` 或 `EXCLUDED`

### deliveryStatus 迁移

默认：

1. 商品订单 -> `DELIVERED`
2. 服务订单且项目完成 -> `DELIVERED`
3. 服务订单且项目未完成 -> `PENDING`
4. 未分类 -> `PENDING`

### 金额迁移

`Order.totalAmount` 优先级：

1. `paidAmount`
2. `grossAmount + priceAdjustment + shippingFee`
3. 0

`financeAmountOverride`：

1. 原值保留

### 客户迁移

映射：

1. `customerId` -> `Order.customerId`
2. `customerMatchStatus` -> `Order.customerMatchStatus`
3. `customerMatchScore` -> `Order.customerMatchScore`
4. `customerMatchReason` -> `Order.customerMatchReason`

快照：

1. `receiverName` -> `buyerNameSnapshot`
2. `receiverPhone` -> `buyerPhoneSnapshot`
3. `orderUser` -> `buyerWechatSnapshot`
4. `receiverAddress` -> `buyerAddressSnapshot`

单位快照：

1. 可从 `receiverAddress` 提取
2. 或先用 `storeName`
3. 低置信度可为空

### 明细迁移

`OrderLine` 来源：

1. 优先解析 `productNamesJson`
2. 无法解析则用 `productNamesRaw` 创建一条明细
3. 再无法解析则用 `externalOrderNo` 创建一条默认明细

金额：

1. 如果能拆分明细金额，使用明细金额
2. 否则单条明细金额 = `Order.totalAmount`

分类：

1. 默认继承 `Order.category`
2. `UNKNOWN` 时保留未知

### 来源记录迁移

每条 `ExternalOrder` 生成一条 `OrderSourceRecord`。

字段：

1. `orderId`
2. `source`
3. `platform`
4. `externalOrderNo`
5. `merchantOrderNo`
6. `duplicateGroupId`
7. `duplicateStatus`
8. `rawJson`
9. `rawText`

`rawJson` 建议包含旧 `ExternalOrder` 所有字段快照，确保不丢原始信息。

### 项目绑定迁移

如果 `ExternalOrder.projectId` 存在：

创建 `OrderProjectLink`。

字段：

1. `orderId`
2. `projectId`
3. `relationType = LINKED`
4. `treatment`
5. `allocatedAmount = null`
6. `isPrimary = true`

`treatment` 映射：

1. `financeTreatment = PROJECT_INCLUDED` -> `PROJECT_INCLUDED`
2. `financeTreatment = STANDALONE` -> `STANDALONE`
3. `financeTreatment = EXCLUDED` -> `EXCLUDED`
4. `AUTO` + 有项目 + 服务 -> `PROJECT_INCLUDED`
5. `AUTO` + 商品 -> `STANDALONE`

### 回款迁移

给 `FinanceReceipt` 填充 `orderId`。

规则：

1. `externalOrderId` 能找到新 `Order` -> 写入 `orderId`
2. 仅有 `externalOrderInvoiceRequestId` 时，通过发票找到外部订单，再找到 `Order`
3. 如果同时存在 `projectId`，保留不变
4. 如果 `customerId` 缺失，可从 `Order.customerId` 补齐

迁移后短期：

1. 保留 `externalOrderId`
2. 保留 `externalOrderInvoiceRequestId`
3. 新计算优先使用 `orderId`

### 发票迁移

短期推荐兼容，不立即重构所有外部订单发票表。

方案 A：短期兼容

1. `ExternalOrderInvoiceRequest` 暂时保留
2. 新增 `orderId` 字段，并关联 `Order`
3. 迁移时根据 `externalOrderId` 填入 `orderId`
4. `ExternalOrderInvoiceCoverage` 暂时保留旧 `externalOrderId` coverage
5. 如需新订单合并开票，新增 `OrderInvoiceCoverage` 或给 coverage 增加 `orderId`
6. 第一轮推荐新增 `OrderInvoiceCoverage`，避免一个 coverage 表同时可空关联两套主表导致约束混乱

方案 B：直接统一发票模型

1. 新建 `OrderInvoice`
2. 迁移 `ExternalOrderInvoiceRequest`
3. 迁移 `ExternalOrderInvoiceItem`
4. 迁移 `ExternalOrderInvoiceCoverage`

建议：

第一轮采用方案 A，降低风险。订单主线稳定后，再单独做发票模型统一。

注意：

1. 如果 PR 4 已经让新订单支持合并开票，必须同时实现新 `OrderInvoiceCoverage`
2. 不允许新订单合并开票继续只写 `ExternalOrderInvoiceCoverage`
3. 旧 coverage 可只读兼容，新的订单 coverage 必须挂新 `Order`

### 合并关系迁移

如果 `ExternalOrder.mergedIntoId` 存在：

1. 找到 source 对应 `Order`
2. 找到 target 对应 `Order`
3. 创建 `OrderMerge`
4. source 标记 `deleted = true` 或 `archived = true`
5. source 不参与财务计算

由于迁移期所有旧 `ExternalOrder` 都生成 `Order`，不要再采用“source 不生成业务 Order”的分支方案。source 订单保留用于审计和重定向，但通过 `archived` 和 `financeTreatment = EXCLUDED` 排除财务计算。

## 兼容层设计

### ID 映射

迁移期需要能从旧 `externalOrderId` 找到新 `orderId`。

必须新增：

`Order.legacyExternalOrderId String? @unique`

原因：

1. 重定向简单
2. 旧 API 兼容简单
3. 回款和发票迁移简单
4. 避免从 rawJson 解析旧 id

稳定后可以保留，不影响业务。

### 旧 API 兼容

迁移期旧 API 有两种处理方式：

1. 只读旧表
2. 读取新 `Order` 并转换成旧响应 shape

推荐：

1. 旧页面退场前只读旧表即可
2. 新页面全部读新 API
3. 不要让旧 API 写新 `Order`

### 旧页面兼容

`/external-orders`：

1. Stage 1：显示迁移提示
2. Stage 2：重定向 `/orders?source=PINGOODMICE`
3. Stage 3：删除页面

`/external-orders/[id]`：

1. 根据 `legacyExternalOrderId` 找 `Order`
2. 重定向 `/orders/[orderId]`

## 部署策略

### Demo 先行

顺序：

1. 在 demo 数据库备份
2. 部署 schema
3. 执行迁移脚本 dry-run
4. 执行迁移脚本 write
5. 部署新页面/API
6. 人工验收

Demo 验收通过后再生产。

### 生产维护窗口

生产建议维护窗口：

1. 暂停用户写入
2. 备份生产 SQLite
3. 部署 schema
4. 执行迁移 dry-run
5. 执行迁移 write
6. 部署新代码
7. 健康检查
8. 抽样验收

SQLite 备份：

1. 复制 `/home/solarise/task-manager-data/prod/dev.db`
2. 远程服务器复制 `/home/ubuntu/task-manager-data/prod/dev.db`

### 回滚策略

如果 schema 已新增但业务未切：

1. 可直接回滚代码
2. 新表不影响旧业务

如果业务已切新 `Order`：

1. 回滚代码会导致新写入订单旧页面不可见
2. 因此切换前必须避免双向写入
3. 维护窗口内发现问题优先修复新代码
4. 必要时恢复数据库备份

回滚前必须判断：

1. 是否已有新订单写入
2. 是否已有新回款绑定 `orderId`
3. 是否已有新发票绑定 `orderId`

## 验收清单

### 数据一致性

1. 旧 `ExternalOrder` 数量与新 `OrderSourceRecord` 数量一致
2. 每条旧订单能找到对应 `Order`
3. `source + externalOrderNo` 唯一性保留
4. 有客户的旧订单迁移后仍有客户
5. 有项目的旧订单迁移后有 `OrderProjectLink`
6. 有回款的旧订单迁移后 `FinanceReceipt.orderId` 非空
7. 有发票的旧订单能从新订单详情追溯
8. 合并订单不重复参与财务

### 金额一致性

1. 迁移前后订单总额差异可解释
2. 迁移前后客户订单金额差异可解释
3. 迁移前后已开票金额不减少
4. 迁移前后已到款金额不减少
5. `PROJECT_INCLUDED` 订单不重复计入
6. `STANDALONE` 订单正常计入
7. `EXCLUDED` 订单不计入

### 页面

1. `/orders` 可访问
2. `/orders` 能显示拼好鼠订单
3. `/orders` 搜索旧外部订单号可命中
4. `/orders/[id]` 能查看来源记录
5. `/orders/[id]` 能查看项目关联
6. `/external-orders` 有迁移提示或重定向
7. 移动端不溢出

### API

1. `GET /api/orders` 正常分页
2. `GET /api/orders/[id]` 返回完整详情
3. 拼好鼠导入写新表
4. 客户匹配写 `Order`
5. 项目绑定写 `OrderProjectLink`
6. 财务聚合读 `Order`

### 权限

1. ADMIN 可见全部订单
2. USER 只能看到 scope 内订单
3. REPRESENTATIVE 不看到财务敏感字段
4. 旧外部订单 API 不泄漏越权数据
5. 财务聚合继续套 scope

## 实施顺序建议给 agent

### PR 1: Schema 与常量

内容：

1. 新增 Prisma 模型
2. 新增常量文件
3. 新增类型 helper
4. 不切业务

验证：

1. prisma generate
2. lint
3. tsc
4. build

### PR 2: 迁移脚本和审计脚本

内容：

1. 审计脚本
2. 迁移脚本 dry-run
3. 迁移脚本 write
4. 迁移报告

验证：

1. dev db dry-run
2. dev db write
3. 重复运行不重复创建

### PR 3: 新订单读 API 和列表页

内容：

1. `GET /api/orders`
2. `GET /api/orders/[id]`
3. `/orders`
4. `/orders/[id]` 只读版

验证：

1. 能查看迁移订单
2. 搜索筛选分页正常

### PR 4: 新写入流程

内容：

1. `/orders/new`
2. 拼好鼠导入写 `Order`
3. 客户匹配写 `Order`
4. 项目绑定写 `OrderProjectLink`
5. 财务设置写 `Order`

验证：

1. 手动订单创建
2. 拼好鼠导入
3. 匹配客户
4. 绑定项目

### PR 5: 财务聚合切换

内容：

1. 财务计算改读 `Order`
2. 回款支持 `orderId`
3. 开票兼容 `orderId`
4. 财务页面调整

验证：

1. 总览
2. 客户看板
3. 进度款明细
4. 已开票未付款
5. 应收与回款

### PR 6: 旧入口退场

内容：

1. `/external-orders` 提示或重定向
2. 删除旧写入口
3. 清理导航
4. 保留必要只读兼容

验证：

1. 旧链接可跳新订单
2. 旧数据可追溯
3. 新入口完整

## 风险点

### 高风险

1. 发票 coverage 迁移丢失
2. 回款和订单断链
3. 合并订单重复计入
4. USER scope 放宽导致财务泄漏
5. 新旧 API 同时写导致数据分叉

### 中风险

1. 商品/服务分类迁移不准确
2. 项目绑定 treatment 推断错误
3. 订单号生成冲突
4. 旧链接无法重定向
5. 移动端新列表溢出

### 低风险

1. 标题生成不理想
2. 单位快照提取不准
3. rawJson 过大

## 明确不做

第一轮迁移不做：

1. 删除旧表
2. 完全统一项目发票和订单发票
3. 成本模型重构
4. 员工绩效规则
5. 多币种
6. 长期双写
