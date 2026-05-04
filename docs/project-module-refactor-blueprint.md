# Blueprint: 项目模块重构

## 状态

本文档是项目模块重构蓝图，不是立即实施 spec。

目标是在统一订单模型落地前，先固定项目模块边界，避免订单重构时把商业金额、财务结算、客户经营逻辑继续塞回项目模块。

相关文档：

1. `docs/business-architecture-refactor-note.md`
2. `docs/unified-order-model-spec.md`
3. `docs/order-workflow-spec.md`
4. `docs/order-project-finance-calculation-spec.md`
5. `docs/order-migration-compatibility-spec.md`

## 核心结论

项目模块应该被定义为：

`项目 = 交付事实`

项目负责回答：

1. 这件事怎么交付
2. 谁负责交付
3. 当前进度如何
4. 有哪些工单和提醒
5. 是否完成
6. 交付过程里发生了什么

项目不应该成为：

1. 商业订单主表
2. 财务结算主表
3. 开票 CRUD 主入口
4. 客户经营主表
5. 员工绩效主表

一句话：

`订单决定商业成立，项目负责履约交付，财务负责结算核算。`

## 当前项目模块的问题

当前 `Project` 模型已经承担了多种职责：

1. 项目基础信息
2. 客户快照信息
3. 代表信息
4. 项目类型和内容
5. 采购/品牌/技术支持
6. 预算金额
7. 成本金额
8. 项目状态和进度
9. 工单、评论、附件、活动
10. 项目发票
11. 外部订单绑定
12. 回款

这些功能短期可用，但长期会导致：

1. 订单金额和项目金额重复
2. 项目页和财务页同时处理开票
3. 项目状态变更直接影响财务，但缺少明确事件边界
4. 项目独立创建和订单生成项目的逻辑不清
5. 员工绩效不知道按订单、项目还是回款归因

## 目标边界

### 项目模块拥有

1. 项目名称
2. 项目描述
3. 项目交付类型
4. 项目内容
5. 项目数量或样本数
6. 交付负责人
7. 项目成员
8. 项目状态
9. 项目进度
10. 预计开始/结束时间
11. 实际完成时间
12. 工单
13. 项目提醒
14. 评论
15. 附件
16. 活动日志
17. 状态历史

### 项目模块只读展示

这些信息可以在项目页展示，但权威来源不在项目模块：

1. 关联订单
2. 订单金额
3. 有效业务额
4. 应收金额
5. 已开票金额
6. 已到款金额
7. 未到款金额
8. 成本
9. 利润
10. CRM 客户摘要

### 项目模块不拥有

1. 订单创建主流程
2. 拼好鼠导入
3. 客户经营状态
4. 开票申请 CRUD
5. 回款登记
6. 成本明细
7. 利润计算
8. 绩效规则

## 项目创建来源

项目可以有三种来源。

### 1. 订单生成项目

这是标准商业交付主线。

流程：

`Order -> OrderProjectLink -> Project`

适用：

1. 单细胞服务订单
2. 空间转录组服务订单
3. 大型服务项目
4. 拼好鼠中被人工识别为服务且需要交付管理的订单

规则：

1. 项目从订单预填客户、标题、内容、金额参考、代表
2. 创建项目后生成 `OrderProjectLink`
3. 默认 `relationType = GENERATED`
4. 默认 `treatment = PROJECT_INCLUDED`
5. 项目完成可联动订单交付

### 2. 项目独立创建

项目允许独立创建，不强制绑定订单。

适用：

1. 早期接触中的大型项目
2. 内部项目
3. 售前试验
4. 需要先建交付流程但商业订单未确认的事项
5. 历史数据补录

规则：

1. 独立项目可以没有订单
2. 独立项目不自动进入订单金额
3. 财务可决定是否计入应收
4. 后续可补绑订单

注意：

不建议用 0 元伪订单表达所有早期项目。

### 3. 项目绑定已有订单

适用：

1. 项目先创建，订单后确认
2. 多个订单并入一个项目
3. 一个订单拆分为多个项目
4. 商品/服务混合订单中的服务部分需要交付

规则：

1. 通过 `OrderProjectLink` 绑定
2. 支持 allocatedAmount
3. 支持 treatment
4. 项目页展示关联订单摘要

## 项目状态模型

### 当前状态建议

可以继续沿用现有 `Project.status` 字符串，但应统一常量。

建议状态：

1. `NOT_STARTED`：未开始
2. `IN_PROGRESS`：进行中
3. `PAUSED`：暂停
4. `COMPLETED`：已完成
5. `CANCELLED`：已取消

### 状态职责

项目状态只表达交付状态。

不表达：

1. 订单是否确认
2. 是否已开票
3. 是否已到款
4. 是否已结算

### 状态变更审计

继续使用 `StatusHistory`，但建议补强：

1. `createdBy` 目前是 String，可后续改为 `createdById`
2. 增加状态变更类型，可选
3. 记录是否触发财务/订单联动

短期不强制改模型，但代码层应集中处理状态变更，避免各页面直接改 `Project.status`。

## 项目完成与订单交付联动

### 默认规则

服务类项目完成后，可以联动相关服务订单：

1. `Project.status -> COMPLETED`
2. 找到 `OrderProjectLink.treatment = PROJECT_INCLUDED`
3. 找到服务类订单或服务明细
4. 将订单交付状态设为 `DELIVERED`
5. 写入订单状态历史

### 不自动回滚

如果项目从 `COMPLETED` 改回 `IN_PROGRESS`：

1. 不自动回滚订单交付
2. 提示用户是否同步回滚
3. 默认保留订单交付状态

原因：

财务可能已经基于完成状态开票或确认应收，自动回滚风险大。

### 人工覆盖

必须允许：

1. 项目完成但不联动订单交付
2. 项目未完成但订单手动交付
3. 部分交付
4. 交付日期人工调整

### 财务影响

项目完成会影响：

1. 服务项目应收从 30% 变成 100%
2. 本期进度款增加 70%
3. 项目交付状态摘要

但财务计算由财务模块执行，项目模块只提供状态事件。

## 项目金额与订单金额

### 项目金额定位

`Project.budgetAmount` 长期应理解为：

项目交付预算/服务金额参考。

它不是订单商业金额的唯一权威。

### 订单金额定位

订单金额权威在 `Order.totalAmount` 和 `OrderLine`。

### 项目应收

项目应收由财务模块根据：

1. `Project.budgetAmount`
2. `Project.status`
3. `Project.progress`
4. `OrderProjectLink.treatment`
5. 财务 override

统一计算。

项目页不直接计算最终应收，只展示财务摘要。

### 金额冲突

如果订单金额与项目金额不一致：

1. 不强制自动覆盖
2. 项目页显示差异
3. 财务页决定使用哪个口径
4. 允许 `allocatedAmount` 分摊

## 项目成本

### 当前字段

当前 `Project.budgetCost` 可继续作为项目成本预估。

### 长期方向

成本应迁到财务模块，建议后续新增：

`FinanceCost`

项目页只展示：

1. 成本摘要
2. 跳转财务成本详情

不在项目页维护复杂成本明细。

## 项目开票和回款

### 目标方向

开票和回款统一归财务模块。

项目页只保留：

1. 开票摘要
2. 回款摘要
3. 未开票摘要
4. 未到款摘要
5. 跳转财务处理

### 当前已做方向

现有 `ProjectInvoiceSection` 已经改成只读摘要并跳转 `/finance/project-invoices?projectId=xxx`，这个方向正确。

后续不要再把完整开票 CRUD 加回项目页。

### 项目页财务摘要

建议展示：

1. 项目金额
2. 关联订单金额
3. 应收金额
4. 已申请开票
5. 已开票
6. 已到款
7. 未开票
8. 未到款

来源：

`GET /api/finance/projects/[projectId]/summary`

或统一项目财务聚合 API。

## 项目与 CRM

项目页可以展示 CRM 摘要：

1. 客户阶段
2. 负责人
3. 最近互动
4. 最近跟进任务
5. 客户关系摘要

但项目模块不应写 CRM 经营状态。

CRM 页可以展示项目摘要：

1. 最近项目
2. 项目状态
3. 项目金额摘要，按权限
4. 项目完成情况

## 项目与员工管理

项目提供员工管理的交付过程数据：

1. 代表关联项目数
2. 项目立项数
3. 项目完成数
4. 项目延期数
5. 项目进度变化
6. 项目交付周期

员工管理中的金额指标不直接从项目页算，应从财务聚合 API 读。

## 项目模型建议调整

### 短期保留字段

这些字段短期保留：

1. `name`
2. `description`
3. `customerId`
4. `representativeId`
5. `projectType`
6. `projectContent`
7. `quantity`
8. `procurementSource`
9. `brand`
10. `techSupport`
11. `budgetAmount`
12. `budgetCost`
13. `status`
14. `progress`
15. `startDate`
16. `endDate`
17. `archived`
18. `deleted`

### 建议新增字段

后续可考虑：

1. `projectCategory`：`SERVICE`、`PRODUCT`、`INTERNAL`、`PRESALES`
2. `sourceType`：`ORDER_GENERATED`、`MANUAL`、`CRM_OPPORTUNITY`、`INTERNAL`
3. `sourceOrderId`：可选主来源订单，便于查询，但不替代 `OrderProjectLink`
4. `deliveryCompletedAt`
5. `deliveryConfirmedById`
6. `financeExcluded`
7. `financeExcludeReason`

注意：

`sourceOrderId` 只能作为主来源快捷字段，不能替代多对多 `OrderProjectLink`。

### 长期弱化字段

这些字段长期应弱化或迁移：

1. `orderNumber`：应由 `Order.orderNo` 替代
2. `organization`：应从客户/机构主数据或快照读取
3. `client`：应由 `customerId` 关联替代
4. `representative`：应由 `representativeId` 关联替代
5. `budgetCost`：长期迁到财务成本模型
6. `invoices`：项目页只读摘要，写入口在财务
7. `externalOrders`：由 `OrderProjectLink` 替代
8. `receipts`：项目页只读摘要，写入口在财务

## API 边界建议

### 项目 API 继续负责

1. `GET /api/projects`
2. `POST /api/projects`
3. `GET /api/projects/[id]`
4. `PATCH /api/projects/[id]`
5. `DELETE /api/projects/[id]` 或软删除
6. 项目状态变更
7. 项目成员
8. 工单
9. 评论
10. 附件
11. 时间线

### 项目 API 不再负责

1. 开票 CRUD
2. 回款登记
3. 订单导入
4. 订单金额权威计算
5. 成本明细 CRUD
6. 利润计算

### 建议新增或规范化

`POST /api/projects/[id]/status`

用途：

统一处理项目状态变更和联动事件。

请求：

1. `status`
2. `progress`
3. `note`
4. `syncOrderDelivery`

行为：

1. 更新项目状态
2. 写 `StatusHistory`
3. 如 `syncOrderDelivery = true`，触发订单交付状态联动
4. 返回项目和联动结果

`GET /api/projects/[id]/order-links`

用途：

展示项目关联订单。

数据来源：

`OrderProjectLink`

`GET /api/projects/[id]/finance-summary`

用途：

项目页展示财务摘要。

数据来源：

财务聚合层。

## 页面重构建议

### `/projects`

项目列表继续保留。

建议强调：

1. 项目名称
2. 客户
3. 项目状态
4. 进度
5. 交付负责人
6. 关联订单数量
7. 交付提醒

金额展示：

1. 可展示项目预算
2. 不展示复杂财务指标
3. 如展示应收/回款，必须来自财务摘要

### `/projects/[id]`

建议 Tabs：

1. 概览
2. 交付进度
3. 工单
4. 关联订单
5. 财务摘要
6. 评论
7. 附件
8. 时间线

### 概览

展示：

1. 项目基础信息
2. 客户
3. 交付状态
4. 进度
5. 时间
6. 成员
7. 最近活动

### 交付进度

展示：

1. 状态历史
2. 进度修改
3. 完成确认
4. 是否联动订单交付

### 关联订单

展示：

1. 关联订单列表
2. 订单金额
3. treatment
4. allocatedAmount
5. 是否主订单
6. 跳转订单详情

操作：

1. 绑定已有订单
2. 解绑订单
3. 调整 treatment
4. 调整 allocatedAmount

如果这些操作涉及财务敏感字段，按权限控制。

### 财务摘要

只读展示：

1. 应收
2. 已开票
3. 已到款
4. 未开票
5. 未到款
6. 成本摘要，按权限
7. 利润摘要，按权限

操作：

1. 去财务开票
2. 去财务登记回款
3. 去财务查看成本

## 迁移顺序建议

### Phase P1: 项目边界冻结

目标：

不再往项目页增加财务 CRUD。

动作：

1. 确认项目页开票只读摘要
2. 确认回款入口跳财务
3. 文案强调交付管理

### Phase P2: 项目状态 API 统一

目标：

项目状态变更集中处理。

动作：

1. 新增或规范 `POST /api/projects/[id]/status`
2. 所有状态变更写 `StatusHistory`
3. 预留订单交付联动参数

### Phase P3: 关联订单 Tab

目标：

项目页从 `externalOrders` 迁到 `OrderProjectLink`。

动作：

1. 展示关联订单
2. 支持绑定/解绑
3. 支持 treatment/allocatedAmount
4. 旧 externalOrders 只迁移期兼容

### Phase P4: 财务摘要改读聚合 API

目标：

项目页不再自行计算发票/回款。

动作：

1. 新增项目财务摘要 API
2. 项目页展示摘要
3. 所有财务操作跳财务模块

### Phase P5: 弱化旧字段

目标：

逐步减少 `orderNumber/client/organization/representative` 文本字段依赖。

动作：

1. 新建项目优先使用关联字段
2. 旧字段作为历史快照显示
3. 后续迁移或只读

## 与订单重构的依赖

订单重构前需要明确：

1. 项目可独立存在
2. 项目不强制绑定订单
3. 订单生成项目通过 `OrderProjectLink`
4. 项目完成联动订单交付必须可关闭
5. 项目页不处理开票和回款 CRUD

订单重构落地后，项目模块需要：

1. 删除对 `ExternalOrder.projectId` 的主依赖
2. 改用 `OrderProjectLink`
3. 项目详情展示关联订单
4. 项目财务摘要读取统一财务聚合

## 验收标准

### 边界

1. 项目页没有完整开票 CRUD
2. 项目页没有回款登记表单
3. 项目页金额摘要来自财务 API
4. 项目状态只表达交付进度

### 订单关联

1. 订单生成项目后能看到关联订单
2. 项目独立创建不要求订单
3. 项目可绑定多个订单
4. 订单可拆分到多个项目
5. treatment 和 allocatedAmount 可追溯

### 状态联动

1. 项目完成写 `StatusHistory`
2. 项目完成可联动订单交付
3. 联动可以关闭
4. 项目状态回滚不自动回滚订单交付

### 财务

1. 项目应收按财务统一口径展示
2. 已开票金额与财务模块一致
3. 已到款金额与财务模块一致
4. 未开票和未到款口径明确

### 移动端

1. 项目列表不横向溢出
2. 项目详情 Tabs 在手机端可用
3. 关联订单卡片不挤压
4. 财务摘要卡片可读

## 明确不做

本轮项目蓝图不做：

1. 员工绩效规则
2. 完整成本模型
3. 项目发票模型重构
4. CRM 机会模型
5. 删除旧 Project 字段
6. 强制所有项目绑定订单
