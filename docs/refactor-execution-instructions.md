# Execution: 订单-项目-财务-CRM-员工管理重构执行说明

## 状态

本文档是给 DeepSeek 的执行说明，不是设计 spec。

前置设计文档：

1. `docs/business-architecture-refactor-note.md`
2. `docs/unified-order-model-spec.md`
3. `docs/order-workflow-spec.md`
4. `docs/order-project-finance-calculation-spec.md`
5. `docs/order-migration-compatibility-spec.md`
6. `docs/project-module-refactor-blueprint.md`
7. `docs/finance-module-refactor-blueprint.md`

## 目标

按最小风险顺序完成重构，避免一次性大改导致：

1. 订单、项目、财务口径分叉
2. 迁移脚本不可回滚
3. 权限 scope 漏洞
4. 移动端 UI 继续溢出
5. 旧入口和新入口同时写入

## 总原则

### 1. 先 schema，后迁移，后新读 API，最后新写入

不要反过来。

### 2. 先打通订单主线，再切项目，再切财务

不要同时在三块里铺开写逻辑。

### 3. 每个 PR 都必须可编译、可 lint、可构建

必须满足：

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run build`

### 4. 关键节点必须停下来 review

不要让 DeepSeek 一口气跑完整个重构后再找 bug。

## 推荐执行顺序

### PR 1: 统一订单模型 schema

目标：

新增统一订单模型，但不切业务。

实现范围：

1. 新增 `Order`
2. 新增 `OrderLine`
3. 新增 `OrderSourceRecord`
4. 新增 `OrderProjectLink`
5. 新增 `OrderStatusHistory`
6. 新增 `OrderMerge`
7. 给 `FinanceReceipt` 增加 `orderId`
8. 给 `Order` 增加 `legacyExternalOrderId`
9. 给 `User`、`Customer`、`Project`、`Representative` 加必要反向关系
10. 增加必要常量/类型文件

不要做：

1. 不要切页面
2. 不要切 API
3. 不要删除旧表
4. 不要改财务计算主路径

### Review Gate A

必须停下来让我 review。

我会重点检查：

1. Prisma relation 是否完整
2. `User / Customer / Project / FinanceReceipt` 反向关系是否正确
3. 命名是否和现有代码冲突
4. 旧 `ExternalOrder` 是否还能正常编译
5. 是否有明显迁移死路

### PR 2: 迁移审计与迁移脚本

目标：

先审计，再迁移，迁移脚本可重复执行。

实现范围：

1. `scripts/audit-external-orders-before-migration.ts`
2. `scripts/migrate-external-orders-to-orders.ts`
3. dry-run 模式
4. 迁移报告输出
5. `legacyExternalOrderId` 或等价映射

要求：

1. 幂等
2. 不删除旧数据
3. 能重复运行
4. 有异常统计
5. 有源订单到新订单的映射
6. 所有旧 `ExternalOrder` 都生成新 `Order`
7. merged source 标记为 `archived` 和 `EXCLUDED`，不参与财务计算

不要做：

1. 不要切页面
2. 不要切财务读路径
3. 不要删除旧 API

### Review Gate B

必须停下来让我 review。

我会重点检查：

1. 迁移脚本是否幂等
2. 是否会覆盖已有数据
3. 合并订单、回款、发票 coverage 是否有映射
4. dry-run 输出是否足够清晰
5. 是否可以在 demo 上先跑

### PR 3: 新订单读 API

目标：

让新 `/orders` 能读到迁移后的统一订单数据。

实现范围：

1. `GET /api/orders`
2. `GET /api/orders/[id]`
3. `GET /api/orders/[id]/summary`
4. `GET /api/orders/[id]/history`
5. `GET /api/orders/[id]/project-links`

要求：

1. scope 正确
2. 支持分页/搜索/筛选
3. 支持移动端需要的摘要字段
4. 支持旧外部订单号搜索

不要做：

1. 不要新增写入口
2. 不要改旧 `/external-orders` 写逻辑

### Review Gate C

建议停下来让我 review。

我会重点检查：

1. 读 API scope 是否正确
2. summary 是否和现有财务口径一致
3. 是否能稳定服务 `/orders` 列表和详情页
4. 是否漏了任何关键字段

### PR 4: 新订单前端与拼好鼠导入切换

目标：

让新订单模块成为主入口。

实现范围：

1. `/orders` 列表页
2. `/orders/[id]` 详情页
3. `/orders/new`
4. `/orders/import/pingoodmice`
5. 客户匹配
6. 项目绑定
7. 财务设置
8. 订单合并
9. 移动端 UI

要求：

1. 订单列表和详情必须移动端可用
2. 新增服务订单、拼好鼠导入、合并、绑定客户、绑定项目都要能用
3. 旧 `/external-orders` 先保留只读或跳转

不要做：

1. 不要在这里同时重构财务总览
2. 不要在这里改项目页开票逻辑

### Review Gate D

建议停下来让我 review。

我会重点检查：

1. 手机端卡片布局是否溢出
2. 新订单导入字段是否完整
3. 客户/项目绑定是否有明显越权
4. 合并逻辑是否和迁移数据一致
5. 旧入口退场是否安全

### PR 5: 订单-项目关联切换

目标：

把项目从 `ExternalOrder.projectId` 思路切到 `OrderProjectLink`。

实现范围：

1. 项目详情展示关联订单
2. 项目页的订单来源改为 `OrderProjectLink`
3. 订单生成项目/绑定项目 UI
4. 项目财务摘要只读展示
5. 项目完成联动订单交付

要求：

1. 项目可以独立存在
2. 项目可以绑定多个订单
3. 订单可以绑定多个项目
4. 不再把项目页当开票入口

### Review Gate E

必须停下来让我 review。

我会重点检查：

1. `OrderProjectLink` 是否真的替代了旧逻辑
2. 项目完成联动订单交付是否可控
3. 项目页是否还保留过多财务写入口
4. 是否还有旧 `ExternalOrder.projectId` 逻辑漏网

### PR 6: 财务聚合切换

目标：

财务计算切到统一订单模型。

实现范围：

1. 财务聚合函数切换到 `Order`
2. 财务总览 API
3. 客户/项目/订单/代表财务汇总 API
4. 订单、项目、客户详情的财务摘要
5. 应收、开票、回款、未到款拆分
6. 成本字段暂时只读兼容现有 `Project.budgetCost`，不在本 PR 做完整成本模块

要求：

1. 利润口径明确
2. 应收、开票、回款、未到款分开
3. 不再从旧 `ExternalOrder` 聚合新订单数据

### Review Gate F

建议停下来让我 review。

我会重点检查：

1. 财务聚合是否还依赖旧 `ExternalOrder`
2. 利润口径是否混乱
3. scope 是否正确
4. 项目页和订单页是否只读摘要

### PR 6b: 成本模型与利润入口

目标：

新增财务成本主表，并把成本和利润纳入财务模块。

实现范围：

1. 新增 `FinanceCost`
2. 新增成本常量和校验
3. 新增 `/finance/costs`
4. 成本可挂客户、订单、项目
5. 财务汇总纳入成本
6. 利润入口或利润摘要

要求：

1. 成本只在财务模块维护
2. 订单页和项目页只显示成本摘要
3. 成本、利润、利润率按权限控制

### Review Gate F2

建议停下来让我 review。

我会重点检查：

1. 成本是否真的归到财务层
2. 成本是否错误写进订单或项目主表
3. 利润基数是否明确
4. scope 是否正确

### PR 7: 发票与回款统一入口

目标：

把项目发票、拼好鼠订单发票、回款入口统一到财务模块。

实现范围：

1. 财务发票工作台
2. 项目发票兼容迁移
3. 订单发票兼容迁移
4. 回款登记兼容迁移
5. coverage 保留和迁移
6. 如新订单支持合并开票，必须新增 `OrderInvoiceCoverage` 或等价新 coverage 关系

不要一口气重做全部发票表，先做兼容层。

### Review Gate G

必须停下来让我 review。

我会重点检查：

1. 发票和回款是否丢关系
2. 合并开票 coverage 是否保住
3. 项目页和订单页是否还在写发票
4. 财务工作台是否能覆盖原功能

### PR 8: 旧入口退场

目标：

让 `/external-orders` 退场，旧写入口关闭。

实现范围：

1. `/external-orders` 跳转或只读提示
2. `/api/external-orders/*` 逐步废弃
3. 导航入口替换
4. 旧组件清理

### Review Gate H

建议停下来让我做最终 review。

我会重点检查：

1. 旧入口是否还存在隐式写入
2. 是否还有旧路径漏出来
3. 生产可用性
4. demo / prod 是否一致

## 哪些节点适合我先 review

### 必须 wait 的节点

建议 DeepSeek 在以下节点完成后等待我验收：

1. PR 1 schema
2. PR 2 迁移脚本
3. PR 3 新订单读 API
4. PR 5 项目关联切换
5. PR 6 财务聚合切换
6. PR 6b 成本模型与利润入口
7. PR 7 发票与回款统一入口

这些节点一旦写错，后面返工成本高。

### 可以不 wait、我最后统一查的节点

以下部分如果 DeepSeek 很稳，可以先连续做，再统一 review：

1. PR 4 的前端页面和 UI 细节
2. PR 8 的旧入口退场和导航收尾

但前提是前面的 schema / 迁移 / API / 财务切换已经验收通过。

## 我 review 时重点看什么

### 1. 结构性风险

1. Prisma relation 是否正确
2. 旧表和新表是否双写
3. 迁移是否幂等
4. scope 是否漏掉
5. 订单-项目-财务是否重复计入

### 2. 业务口径风险

1. 订单金额是否和项目金额混用
2. 成本是否混进订单主表
3. 应收、已开票、已到款是否混口径
4. 合并订单是否还在重复计费
5. 项目完成是否误回滚订单交付

### 3. UI 风险

1. 移动端是否溢出
2. 长文本是否换行爆卡
3. 按钮是否互相挤压
4. 批量操作栏是否遮挡底部导航

### 4. 权限风险

1. USER 是否能越 scope 看财务
2. REPRESENTATIVE 是否看到财务敏感字段
3. 订单/项目绑定是否有越权
4. 财务入口是否只允许 ADMIN 或授权用户

## 给 DeepSeek 的执行约束

1. 每个 PR 结束必须跑 `npm run lint`
2. 每个 PR 结束必须跑 `npx tsc --noEmit`
3. 每个 PR 结束必须跑 `npm run build`
4. 不允许跳过 review gate
5. 不允许一口气做完全部再让我看
6. 不允许在项目页和订单页继续加财务 CRUD
7. 不允许长期保留双写逻辑

## 建议的执行节奏

### 推荐节奏 A：稳健

1. PR 1 -> review
2. PR 2 -> review
3. PR 3 -> review
4. PR 4 -> 可连续
5. PR 5 -> review
6. PR 6 -> review
7. PR 7 -> review
8. PR 8 -> review

适合：

1. 你想尽量避免回滚
2. 迁移风险不能高
3. 业务口径不能错

### 推荐节奏 B：更快

1. PR 1 -> review
2. PR 2 -> review
3. PR 3 + PR 4 -> review
4. PR 5 -> review
5. PR 6 + PR 7 -> review
6. PR 8 -> review

适合：

1. DeepSeek 代码质量稳定
2. UI 部分可批量验收

## 明确不做

这份执行说明不直接要求：

1. 员工绩效完整实现
2. CRM 重构
3. 广告/市场模块实现
4. 订单以外新业务模块实现
5. 多币种
6. 复杂回款分摊在第一轮就完整实现
