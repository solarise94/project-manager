# Spec: 订单业务流程

## 状态

本文档是订单业务流程设计 spec 草案，承接：

1. `docs/business-architecture-refactor-note.md`
2. `docs/unified-order-model-spec.md`

目标是明确统一订单模块的页面、API、状态流和旧 `/external-orders` 的退场路径。

本文不直接要求实现。

## 设计目标

统一订单模块需要把两类订单合流：

1. 主动创建的服务订单
2. 拼好鼠导入订单

最终形成：

`/orders` 作为统一订单入口

`/external-orders` 不再作为主业务入口

订单模块负责商业事实，财务模块负责结算事实，项目模块负责交付事实。

## 导航与页面结构

### 推荐导航

主导航建议：

1. 订单管理
2. 项目管理
3. 财务管理
4. CRM 管理
5. 员工管理

订单管理下建议页面：

1. `/orders`：统一订单列表
2. `/orders/new`：新建服务订单
3. `/orders/import/pingoodmice`：拼好鼠订单导入
4. `/orders/[id]`：订单详情
5. `/orders/review`：重复订单/异常订单复核，可选

### `/orders` 统一订单列表

用途：

统一展示所有订单，包括手动服务订单、拼好鼠订单和后续其他导入订单。

推荐功能：

1. 搜索订单号、外部订单号、客户、电话、单位、项目
2. 按来源筛选：全部、手动、拼好鼠、其他导入
3. 按状态筛选：草稿、已确认、已取消、已关闭
4. 按交付状态筛选：未交付、部分交付、已交付、无需交付
5. 按分类筛选：服务、商品、混合、未分类
6. 按客户匹配状态筛选
7. 按财务计入口径筛选
8. 支持分页
9. 支持移动端卡片布局
10. 支持批量操作

列表建议字段：

1. 内部订单号
2. 来源
3. 外部订单号
4. 订单标题
5. 客户
6. 单位/地址快照
7. 金额
8. 分类
9. 状态
10. 交付状态
11. 关联项目
12. 财务计入口径
13. 下单/确认时间

批量操作建议：

1. 批量客户匹配
2. 批量设为商品
3. 批量设为服务
4. 批量排除财务
5. 批量合并
6. 批量绑定项目，谨慎开放

### `/orders/new` 新建服务订单

用途：

手动创建主动服务订单，主要用于单细胞、空间转录组等较大的服务项目。

推荐表单分区：

1. 基本信息
2. 客户信息
3. 订单明细
4. 项目生成选项
5. 财务设置
6. 负责人/代表

基本信息：

1. 订单标题
2. 订单来源固定为 `MANUAL`
3. 订单分类默认 `SERVICE`
4. 下单日期
5. 备注

客户信息：

1. 选择已有客户
2. 新增客户
3. 暂不绑定客户
4. 自动保存客户快照

订单明细：

1. 服务名称
2. 规格
3. 数量
4. 金额
5. 明细分类
6. 总金额自动汇总

项目生成选项：

1. 只创建订单
2. 创建订单并生成项目
3. 创建订单并绑定已有项目

默认建议：

1. 服务订单推荐创建项目
2. 商品订单不推荐创建项目
3. 允许稍后再绑定项目

财务设置：

1. 财务金额覆盖
2. 计入口径
3. 财务备注

创建后状态：

1. 如果保存草稿，`status = DRAFT`
2. 如果确认创建，`status = CONFIRMED`
3. 如果同时生成项目，创建 `OrderProjectLink.relationType = GENERATED`

### `/orders/import/pingoodmice` 拼好鼠导入

用途：

替代旧 `/external-orders` 的导入主入口。

流程：

1. 上传 CSV
2. 解析预览
3. 按 `source + externalOrderNo` 去重
4. 生成或更新 `OrderSourceRecord`
5. 创建或更新对应 `Order`
6. 创建或更新 `OrderLine`
7. 执行客户匹配
8. 展示导入结果

导入结果分类：

1. 新增订单
2. 更新订单
3. 重复订单
4. 需要人工复核
5. 解析失败

拼好鼠字段映射：

1. 下单用户 -> `buyerWechatSnapshot`
2. 收件人 -> `buyerNameSnapshot`
3. 收件人电话 -> `buyerPhoneSnapshot`
4. 收件人地址 -> `buyerAddressSnapshot`
5. 商品名称 -> `OrderLine`
6. 实付金额 -> `Order.totalAmount`
7. 订单号 -> `externalOrderNo`
8. 原始行 -> `OrderSourceRecord.rawJson`

导入后默认规则：

1. `source = PINGOODMICE`
2. `status = CONFIRMED`
3. 商品/服务分类先按规则自动判断，低置信度为 `UNKNOWN`
4. 客户自动匹配，高置信度写入 `customerId`
5. 不自动绑定项目
6. 不自动开票

### `/orders/[id]` 订单详情

详情页建议 Tabs：

1. 概览
2. 明细
3. 客户匹配
4. 关联项目
5. 财务设置
6. 开票与回款摘要
7. 来源记录
8. 操作日志

概览：

1. 订单号
2. 来源
3. 状态
4. 交付状态
5. 客户
6. 金额
7. 分类
8. 关联项目摘要
9. 财务计入口径

明细：

1. 展示和编辑 `OrderLine`
2. 支持商品/服务分类调整
3. 支持重新汇总订单金额

客户匹配：

1. 展示当前匹配客户
2. 展示匹配理由
3. 支持人工绑定客户
4. 支持新增客户并绑定
5. 支持解除绑定

关联项目：

1. 展示所有 `OrderProjectLink`
2. 支持绑定已有项目
3. 支持从订单生成项目
4. 支持调整 treatment
5. 支持填写 allocatedAmount
6. 支持设置主项目

财务设置：

1. 调整订单分类
2. 调整财务金额 override
3. 调整默认 financeTreatment
4. 写财务备注

开票与回款摘要：

1. 展示已开票金额
2. 展示已到款金额
3. 展示未到款金额
4. 跳转财务模块处理

来源记录：

1. 展示拼好鼠原始字段
2. 展示导入批次
3. 展示 rawJson
4. 展示重复状态

操作日志：

1. 状态变更
2. 客户绑定
3. 项目绑定
4. 财务设置修改
5. 合并记录

## 订单状态流

### 状态定义

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

### 状态流规则

允许：

1. `DRAFT -> CONFIRMED`
2. `DRAFT -> CANCELLED`
3. `CONFIRMED -> CANCELLED`
4. `CONFIRMED -> CLOSED`
5. `CANCELLED -> DRAFT`，仅 ADMIN
6. `CLOSED -> CONFIRMED`，仅 ADMIN

不建议：

1. 删除已确认订单
2. 删除有发票或回款的订单
3. 普通 USER 回滚已关闭订单

### 交付状态流规则

允许：

1. `PENDING -> PARTIAL`
2. `PENDING -> DELIVERED`
3. `PARTIAL -> DELIVERED`
4. 任意状态 -> `WAIVED`，仅 ADMIN 或财务权限

联动：

1. 商品订单确认后可自动设为 `DELIVERED`
2. 服务订单绑定项目后，项目完成可自动设为 `DELIVERED`
3. 项目重新打开时，不自动回滚订单交付，需要人工确认

### 审计

所有状态变化写入 `OrderStatusHistory`。

至少记录：

1. oldStatus
2. newStatus
3. oldDeliveryStatus
4. newDeliveryStatus
5. note
6. createdById
7. createdAt

## 客户匹配流程

### 自动匹配

拼好鼠导入后自动执行客户匹配。

匹配优先级建议：

1. 微信号精确匹配
2. 手机号精确匹配
3. 姓名 + 单位/地址匹配
4. 姓名 + 手机尾号弱匹配
5. 地址机构名匹配

匹配结果：

1. 高置信度：写入 `customerId`，`customerMatchStatus = AUTO_MATCHED`
2. 多候选冲突：`customerMatchStatus = CONFLICT`
3. 无结果：`customerMatchStatus = UNMATCHED`

### 人工匹配

人工操作：

1. 绑定已有客户
2. 新增客户并绑定
3. 解除绑定
4. 标记无法匹配

人工绑定后：

1. `customerMatchStatus = MANUAL_MATCHED`
2. 写入 `customerMatchReason`
3. 记录操作日志

## 项目绑定流程

### 从订单生成项目

适用：

1. 手动服务订单
2. 拼好鼠中实际是服务类的订单
3. 大额订单需要交付流程

流程：

1. 选择“生成项目”
2. 预填项目名称、客户、金额、代表、项目内容
3. 用户确认项目字段
4. 创建 `Project`
5. 创建 `OrderProjectLink`

默认：

1. `relationType = GENERATED`
2. 服务订单 `treatment = PROJECT_INCLUDED`
3. `isPrimary = true`

### 绑定已有项目

适用：

1. 订单补充到已有项目
2. 多个拼好鼠订单归属于同一项目
3. 项目先创建，后续补订单

流程：

1. 搜索项目
2. 校验客户一致性
3. 如客户不一致，ADMIN 才能强制绑定
4. 创建或更新 `OrderProjectLink`

默认：

1. 服务类订单：`PROJECT_INCLUDED`
2. 商品类订单：`STANDALONE`
3. 未分类订单：提示人工选择

### 解绑项目

允许条件：

1. 无财务锁定
2. 或 ADMIN 强制

解绑后：

1. 删除或归档 `OrderProjectLink`
2. 重新计算财务汇总
3. 记录日志

## 订单合并流程

### 合并对象

支持合并：

1. 拼好鼠重复订单
2. 同一外部订单不同来源记录
3. 人工误创建重复订单

不建议合并：

1. 已产生独立发票且无法迁移的订单
2. 已有复杂回款拆分的订单
3. 客户冲突且无法确认的订单

### 合并规则

合并时选择一个主订单。

主订单保留：

1. orderNo
2. 当前客户
3. 主要项目关联
4. 财务设置

来源订单迁移：

1. `OrderSourceRecord` 移到主订单
2. `OrderLine` 可选择合并或保留为来源明细
3. `OrderProjectLink` 迁移或去重
4. 发票覆盖关系迁移
5. 回款记录迁移
6. 写入 `OrderMerge`

合并后：

1. 来源订单标记为 `deleted` 或 `archived`
2. 不再参与财务计算
3. 仍可从合并记录追溯

## 财务设置流程

订单页只做财务基础设置，不直接处理开票和回款。

可设置：

1. 分类：商品、服务、混合、未分类
2. financeTreatment：自动、独立计入、并入项目、排除
3. financeAmountOverride
4. financeNote

不可在订单页处理：

1. 开票申请 CRUD
2. 到款登记
3. 成本录入
4. 利润调整

这些进入财务模块。

## 财务跳转

订单详情应提供跳转：

1. 去开票
2. 查看开票记录
3. 登记到款
4. 查看应收详情

推荐 URL：

1. `/finance/project-invoices?orderId=xxx`
2. `/finance/order-invoices?orderId=xxx`
3. `/finance/receipts?orderId=xxx`
4. `/finance/receivables?orderId=xxx`

具体是否拆 `order-invoices` 可在财务 spec 中决定。

## API 设计草案

### 订单列表

`GET /api/orders`

查询参数：

1. `page`
2. `pageSize`
3. `search`
4. `source`
5. `status`
6. `deliveryStatus`
7. `category`
8. `customerMatchStatus`
9. `financeTreatment`
10. `customerId`
11. `projectId`

返回：

1. `orders`
2. `total`
3. `page`
4. `pageSize`
5. `totalPages`

### 新建订单

`POST /api/orders`

支持：

1. 创建草稿
2. 创建并确认
3. 创建并生成项目
4. 创建并绑定项目

请求体核心字段：

1. `title`
2. `category`
3. `status`
4. `customerId`
5. `lines`
6. `totalAmount`
7. `representativeId`
8. `projectAction`
9. `projectId`
10. `projectDraft`

### 订单详情

`GET /api/orders/[id]`

返回：

1. 订单主表
2. 明细
3. 来源记录
4. 项目关联
5. 发票摘要
6. 回款摘要
7. 状态历史

### 更新订单

`PATCH /api/orders/[id]`

允许更新：

1. 标题
2. 描述
3. 分类
4. 客户
5. 明细
6. 财务设置
7. 负责人

需要注意：

1. 有发票/回款时限制金额修改
2. 修改金额需要记录日志
3. 修改客户需要校验项目/发票/回款一致性

### 状态变更

`POST /api/orders/[id]/status`

请求：

1. `status`
2. `deliveryStatus`
3. `note`

### 拼好鼠导入

`POST /api/orders/import/pingoodmice`

流程：

1. 接收 CSV
2. 解析
3. upsert `OrderSourceRecord`
4. upsert `Order`
5. 创建或更新明细
6. 返回导入统计

### 客户匹配

`POST /api/orders/match-scan`

支持：

1. 全量扫描
2. 按 orderIds 扫描
3. 按 source 扫描
4. 只扫描未匹配

`POST /api/orders/[id]/bind-customer`

支持：

1. 绑定已有客户
2. 新增客户并绑定
3. 解除绑定

### 项目绑定

`POST /api/orders/[id]/project-links`

创建关联。

`PATCH /api/orders/[id]/project-links/[linkId]`

更新：

1. treatment
2. allocatedAmount
3. isPrimary
4. note

`DELETE /api/orders/[id]/project-links/[linkId]`

解绑。

### 合并

`POST /api/orders/merge`

请求：

1. `targetOrderId`
2. `sourceOrderIds`
3. `reason`

返回：

1. 合并后的主订单
2. 迁移记录
3. 冲突提示

## 旧 `/external-orders` 退场方案

### Stage 1: 保留入口但提示迁移

1. `/external-orders` 顶部显示“订单管理已迁移”
2. 提供跳转 `/orders?source=PINGOODMICE`
3. 旧页面只读或限制写入

### Stage 2: 重定向

1. `/external-orders` 重定向到 `/orders?source=PINGOODMICE`
2. `/external-orders/[id]` 重定向到对应 `/orders/[orderId]`
3. 需要依赖迁移映射

### Stage 3: 删除旧入口

1. 删除旧页面
2. 删除旧前端组件
3. 保留必要旧 API 一段时间
4. 最终删除旧 API

## 权限规则

### ADMIN

1. 所有订单可见
2. 可导入拼好鼠
3. 可合并订单
4. 可删除或恢复订单
5. 可改财务设置
6. 可强制绑定客户/项目

### USER

1. 可见自己项目 scope 或 CRM scope 内订单
2. 可创建手动订单
3. 可编辑自己创建或有权限项目相关订单
4. 不可合并复杂订单，除非授权
5. 财务字段按财务权限控制

### REPRESENTATIVE

暂定：

1. 不显示财务敏感字段
2. 是否开放订单管理需另行确认
3. 如果开放，只读查看自己客户/项目相关订单摘要

## 移动端 UI 要求

订单列表移动端必须使用卡片，不使用横向表格。

卡片建议结构：

1. 第一行：checkbox、订单号、状态
2. 第二行：标题、金额
3. 第三行：客户、单位或地址
4. 第四行：来源、分类、交付状态
5. 第五行：项目关联摘要
6. 底部：查看、匹配客户、绑定项目等操作

要求：

1. 长文本必须 truncate 或 break-words
2. Badge 必须 `whitespace-nowrap`
3. 批量操作固定底部时避让 mobile nav
4. 商品/服务/财务计入口径必须在手机端可见

## 验收标准

### 业务

1. 手动服务订单可以创建
2. 拼好鼠 CSV 导入后生成统一订单
3. 两类订单出现在同一 `/orders` 列表
4. 订单可以匹配或新增客户
5. 订单可以绑定一个或多个项目
6. 订单可以从详情页跳转财务处理
7. `/external-orders` 不再作为主业务入口

### 状态

1. 订单状态变更有审计
2. 交付状态变更有审计
3. 商品订单确认后可自动交付
4. 项目完成可联动服务订单交付
5. 联动结果允许人工覆盖

### 财务边界

1. 订单页不直接做开票 CRUD
2. 订单页不直接登记回款
3. 财务设置修改后财务看板能重新计算
4. 并入项目订单不重复计入

### 旧入口

1. 旧 `/external-orders` 有明确迁移处理
2. 旧数据可以追溯
3. 旧外部订单号仍可搜索
4. 旧发票和回款不丢失

## 实施注意事项

1. 不要在新 `/orders` 页面继续调用旧 `/api/external-orders` 作为主数据源
2. 不要让拼好鼠导入绕过 `OrderSourceRecord`
3. 不要让订单页重新承担财务开票 CRUD
4. 不要在没有审计的情况下修改订单状态
5. 不要让移动端表格横向溢出
6. 不要长期双写 `ExternalOrder` 和 `Order`
