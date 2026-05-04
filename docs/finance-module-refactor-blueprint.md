# Blueprint: 财务模块重构

## 状态

本文档是财务模块重构蓝图，不是立即实施 spec。

目标是在统一订单模型和项目边界明确后，固定财务模块的职责：计算进度款、应收、开票、回款、成本和利润，并为 CRM、员工管理、管理看板提供统一财务口径。

相关文档：

1. `docs/business-architecture-refactor-note.md`
2. `docs/unified-order-model-spec.md`
3. `docs/order-workflow-spec.md`
4. `docs/order-project-finance-calculation-spec.md`
5. `docs/order-migration-compatibility-spec.md`
6. `docs/project-module-refactor-blueprint.md`

## 核心结论

财务模块应该被定义为：

`财务 = 结算与核算事实`

财务负责回答：

1. 当前有效业务额是多少
2. 当前应收是多少
3. 本周/月/季/年进度款是多少
4. 已申请开票多少
5. 已开票多少
6. 已到款多少
7. 未开票多少
8. 已开票未付款多少
9. 应收未到款多少
10. 成本是多少
11. 利润和利润率是多少

一句话：

`订单提供商业金额，项目提供交付状态，财务负责把它们转成可审计的结算结果。`

## 模块边界

### 财务模块拥有

1. 财务计算口径
2. 进度款计算
3. 应收账款计算
4. 开票申请
5. 开票状态
6. 回款登记
7. 回款分摊
8. 成本记录
9. 利润计算
10. 财务看板
11. 财务导出
12. 财务审计记录

### 财务模块读取

财务模块从其他模块读取输入：

1. `Order`：订单金额、订单明细、商品/服务分类、订单来源、客户、代表
2. `OrderProjectLink`：订单与项目关系、计入口径、分摊金额
3. `Project`：项目状态、进度、预算金额、完成时间
4. `Customer`：客户主数据
5. `Representative`：代表归属
6. `CRM`：后续可读取 owner 或归属信息，但不作为金额权威

### 财务模块不拥有

1. 订单创建
2. 拼好鼠导入
3. 项目交付状态主流程
4. CRM 沟通记录
5. 员工绩效规则

## 成本归属原则

成本应放在财务模块。

原因：

1. 成本是核算事实，不是商业事实
2. 一笔成本可能对应订单、项目、客户或多个对象
3. 成本可能分批发生
4. 成本可能调整、冲销或重分类
5. 利润率计算必须在财务层统一

订单页和项目页可以展示成本摘要，但不能成为成本主维护入口。

## 成本模型建议

### FinanceCost

建议后续新增：

```prisma
model FinanceCost {
  id           String   @id @default(cuid())
  customerId   String?
  orderId      String?
  projectId    String?
  amount       Float
  costType     String
  occurredAt   DateTime @default(now())
  remark       String?
  createdById  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([customerId])
  @@index([orderId])
  @@index([projectId])
  @@index([occurredAt])
  @@index([costType])
}
```

### costType 建议

1. `PROCUREMENT`：采购成本
2. `EXPERIMENT`：实验成本
3. `LABOR`：人工成本
4. `LOGISTICS`：物流成本
5. `PLATFORM`：平台成本
6. `MARKETING`：市场获客成本
7. `ENTERTAINMENT`：招待成本
8. `REFUND`：退款/冲减
9. `OTHER`：其他

### 挂载规则

1. 商品采购成本优先挂 `orderId`
2. 服务实验成本优先挂 `projectId`
3. 客户层面的招待或市场成本可挂 `customerId`
4. 多订单/多项目共享成本后续用分摊表

### FinanceCostAllocation

长期建议新增分摊表：

```prisma
model FinanceCostAllocation {
  id        String @id @default(cuid())
  costId    String
  orderId   String?
  projectId String?
  customerId String?
  amount    Float
  note      String?
  createdAt DateTime @default(now())
}
```

第一轮可以不做分摊表，但模型设计要预留。

## 财务核心口径

### 有效业务额

`effectiveBusinessAmount`

来源：

1. 独立计入订单
2. 并入项目后的项目金额
3. 独立项目金额，前提是财务确认计入

排除：

1. `EXCLUDED` 订单
2. 已合并来源订单
3. 已并入项目后重复的订单金额

### 进度款

`progressReceivableAmount`

规则：

1. 服务项目立项计 30%
2. 服务项目完成计剩余 70%
3. 同周期立项并完成计 100%
4. 商品订单确认计 100%
5. 独立服务订单按交付状态计算

### 应收

`receivableAmount`

截至当前应收：

1. 商品订单 100%
2. 服务项目未完成 30%
3. 服务项目完成 100%
4. 独立服务订单按交付状态
5. 未分类订单不自动计入，需人工确认

### 已开票

`invoicedAmount`

建议拆分：

1. `requestedInvoiceAmount`：已申请
2. `issuedInvoiceAmount`：已开具
3. `effectiveInvoiceAmount`：非取消发票合计

### 已到款

`receiptAmount`

来源：

1. `FinanceReceipt`

统计时应支持：

1. 客户维度
2. 订单维度
3. 项目维度
4. 发票维度
5. 代表维度

### 未开票

`uninvoicedAmount`

默认：

`max(receivableAmount - effectiveInvoiceAmount, 0)`

### 已开票未付款

`issuedUnpaidAmount`

默认：

`max(issuedInvoiceAmount - invoiceAllocatedReceiptAmount, 0)`

### 应收未到款

`receivableOutstandingAmount`

默认：

`max(receivableAmount - receiptAmount, 0)`

### 利润

建议输出多口径：

1. 业务利润：`effectiveBusinessAmount - costAmount`
2. 应收利润：`receivableAmount - costAmount`
3. 回款利润：`receiptAmount - costAmount`

看板默认口径需要明确，不要混用。

### 利润率

建议：

1. 收入基数为 0 时返回 null
2. 不返回 0，避免误导
3. 展示时标明基数口径

## 开票模块重构方向

### 当前问题

当前存在：

1. 项目发票 `ProjectInvoice`
2. 外部订单发票 `ExternalOrderInvoiceRequest`
3. 合并开票 coverage
4. 财务项目开票入口
5. 拼好鼠订单开票入口

短期已经把项目页开票 CRUD 移到财务模块，这是正确方向。

### 长期方向

建议统一成财务发票工作台。

页面：

1. `/finance/invoices`
2. `/finance/project-invoices` 可作为过渡
3. `/finance/order-invoices` 可作为订单发票视图

模型长期可考虑统一：

`FinanceInvoice`

支持挂：

1. customerId
2. orderId
3. projectId
4. coverage
5. items

但第一轮重构不强制统一发票表，避免风险过大。

### 第一轮策略

第一轮建议：

1. 保留 `ProjectInvoice`
2. 保留 `ExternalOrderInvoiceRequest`
3. 给订单发票补 `orderId` 兼容
4. 财务页面统一入口
5. 项目页和订单页只读摘要并跳转财务

## 回款模块重构方向

### FinanceReceipt

当前已有 `FinanceReceipt`，后续应成为统一回款事实表。

建议支持：

1. `customerId`
2. `orderId`
3. `projectId`
4. `projectInvoiceId`
5. `orderInvoiceId`
6. `amount`
7. `receivedAt`
8. `source`
9. `remark`

迁移期保留：

1. `externalOrderId`
2. `externalOrderInvoiceRequestId`

### 回款分摊

长期需要：

`FinanceReceiptAllocation`

用于支持：

1. 一笔回款对应多张发票
2. 一笔回款对应多个项目
3. 一笔回款对应多个订单
4. 预收款后续分摊

第一轮可以先不做，但蓝图中必须预留。

## 财务页面结构建议

### `/finance`

财务总览。

展示：

1. 有效业务额
2. 本周进度款
3. 本月进度款
4. 应收
5. 已申请开票
6. 已开票
7. 已到款
8. 应收未到款
9. 已开票未付款
10. 成本
11. 利润

### `/finance/receivables`

应收工作台。

支持视图：

1. 按客户
2. 按订单
3. 按项目
4. 按代表

### `/finance/progress-receivables`

进度款明细。

支持：

1. 本周
2. 本月
3. 本季
4. 本年
5. 服务 30%
6. 服务 70%
7. 商品 100%

### `/finance/invoices`

统一开票工作台。

支持：

1. 项目开票
2. 订单开票
3. 合并开票
4. 已申请
5. 已开具
6. 已取消
7. 超额开票提示

### `/finance/receipts`

到款工作台。

支持：

1. 登记回款
2. 绑定客户
3. 绑定订单
4. 绑定项目
5. 绑定发票
6. 后续分摊

### `/finance/costs`

成本工作台。

支持：

1. 新增成本
2. 按订单挂载
3. 按项目挂载
4. 按客户挂载
5. 成本类型筛选
6. 成本导出

### `/finance/profit`

利润分析。

支持：

1. 按客户
2. 按订单
3. 按项目
4. 按代表
5. 按时间
6. 按产品/服务类型

第一轮可以不做独立页面，但 API 应预留。

## 标准聚合 API

财务模块需要提供统一聚合 API，避免 CRM、员工管理、首页看板各自重复计算。

### 总览

`GET /api/finance/summary`

返回：

1. effectiveBusinessAmount
2. receivableAmount
3. weekProgressReceivable
4. monthProgressReceivable
5. requestedInvoiceAmount
6. issuedInvoiceAmount
7. receiptAmount
8. receivableOutstandingAmount
9. issuedUnpaidAmount
10. costAmount
11. profitAmount
12. profitRate

### 客户聚合

`GET /api/finance/customers`

### 订单聚合

`GET /api/finance/orders`

### 项目聚合

`GET /api/finance/projects`

### 代表聚合

`GET /api/finance/representatives`

供员工管理使用。

### 单对象摘要

建议新增：

1. `GET /api/finance/customers/[id]/summary`
2. `GET /api/finance/orders/[id]/summary`
3. `GET /api/finance/projects/[id]/summary`
4. `GET /api/finance/representatives/[id]/summary`

## 权限设计

### ADMIN

1. 可见全部财务
2. 可开票
3. 可登记回款
4. 可维护成本
5. 可查看利润
6. 可导出

### USER

1. 按项目 scope、订单 scope、CRM scope 查看
2. 是否能开票按当前业务权限决定
3. 成本和利润默认应受限
4. 不应越权看到非 scope 客户财务

### REPRESENTATIVE

当前建议：

1. 不进入财务模块
2. 可在订单/CRM/员工模块看到有限摘要，视业务确认
3. 不显示成本、利润、override、财务备注

## 财务审计

后续建议所有关键变更写审计：

1. 修改 financeAmountOverride
2. 修改订单 treatment
3. 新增/修改/删除成本
4. 新增/修改/删除回款
5. 发票状态变化
6. 手动调整应收
7. 排除订单或项目

可先复用 `ActivityLog`，长期可新增：

`FinanceAuditLog`

## 与其他模块关系

### 与订单模块

订单提供：

1. 订单金额
2. 商品/服务分类
3. 客户
4. 代表
5. 订单来源
6. 订单项目关联

财务返回：

1. 应收摘要
2. 开票摘要
3. 回款摘要
4. 成本摘要
5. 利润摘要

订单页只读展示这些摘要。

### 与项目模块

项目提供：

1. 项目状态
2. 项目进度
3. 项目预算金额
4. 项目完成时间

财务返回：

1. 项目应收
2. 项目开票
3. 项目回款
4. 项目成本
5. 项目利润

项目页只读展示这些摘要。

### 与 CRM

CRM 读取：

1. 客户订单额
2. 客户应收
3. 客户回款
4. 客户利润率，按权限

CRM 不写财务事实。

### 与员工管理

员工管理读取：

1. 代表订单额
2. 代表进度款
3. 代表回款
4. 代表利润，按权限

员工管理不直接读原始财务表拼口径。

## 迁移顺序建议

### Phase F1: 财务边界冻结

目标：

确认订单页、项目页不再承载开票和回款 CRUD。

动作：

1. 保留摘要
2. 操作跳财务
3. 文案统一

### Phase F2: 聚合函数统一

目标：

把有效业务额、应收、开票、回款、成本、利润集中到 `src/lib/finance`。

动作：

1. 不在页面复制计算
2. 统一 helper
3. 统一 scope

### Phase F3: 订单模型切换

目标：

财务计算从 `ExternalOrder` 切换到 `Order`。

依赖：

1. 统一订单模型迁移完成
2. `OrderProjectLink` 可用
3. `FinanceReceipt.orderId` 可用

### Phase F4: 成本模块

目标：

新增成本记录能力。

动作：

1. 新增 `FinanceCost`
2. 新增 `/finance/costs`
3. 汇总 API 纳入成本
4. 利润初步可用

### Phase F5: 回款分摊

目标：

支持复杂回款。

动作：

1. 新增 `FinanceReceiptAllocation`
2. 支持一笔回款分摊多发票/项目/订单
3. 已开票未付款更准确

### Phase F6: 发票模型统一

目标：

长期统一项目发票和订单发票。

动作：

1. 设计 `FinanceInvoice`
2. 迁移旧 `ProjectInvoice`
3. 迁移旧 `ExternalOrderInvoiceRequest`
4. 统一 coverage

注意：

这一步风险较大，建议放在订单和成本稳定之后。

## 验收标准

### 边界

1. 订单页不做开票 CRUD
2. 项目页不做开票 CRUD
3. 订单页不登记回款
4. 项目页不登记回款
5. 成本只在财务模块维护

### 计算

1. 有效业务额不重复
2. 应收口径明确
3. 已开票和已申请分开
4. 应收未到款和开票未到款分开
5. 成本可按订单/项目/客户汇总
6. 利润率基数明确

### 权限

1. ADMIN 可看全部
2. USER 按 scope
3. REPRESENTATIVE 不看到财务敏感字段
4. 成本和利润有权限控制

### 页面

1. 财务总览指标清楚
2. 进度款可点进明细
3. 已开票未付款有入口
4. 未开票有入口
5. 成本有独立入口
6. 移动端不溢出

## 明确不做

第一轮不做：

1. 删除旧发票表
2. 统一所有发票模型
3. 复杂成本分摊
4. 自动利润绩效
5. 代表端财务开放
6. 多币种
