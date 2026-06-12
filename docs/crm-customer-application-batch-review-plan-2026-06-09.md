# CRM 客户申请批量复核 Fix Plan

日期：2026-06-09

## 1. 范围

### 1.1 本文覆盖范围

- CRM 客户申请页 `/crm/customer-applications`
- 客户申请单条复核 API `src/app/api/crm/customer-applications/[id]/route.ts`
- 客户申请批量 API `src/app/api/crm/customer-applications/batch/route.ts`

### 1.2 本文不覆盖范围

- “待创建”链路的业务规则重构
- 客户绑定已有客户的批量化
- 客户申请表单本身的字段或提交流程调整

## 2. 现状结论

### 2.1 结论

- 当前地区经理没有“客户申请复核”的批量处理能力。
- 当前不仅地区经理没有，整个“待复核”链路都没有批量复核能力。
- 现有批量接口只服务于 `ADMIN` 的“待创建”队列，不服务于 `ADMIN / REGIONAL_MANAGER` 的“待复核”队列。

### 2.2 代码证据

1. 页面上的批量选择与批量操作条，只在 `ADMIN + view=pending` 时显示。
   - `src/app/crm/customer-applications/page.tsx:455`
   - `src/app/crm/customer-applications/page.tsx:471`

2. 地区经理在“待复核”视图只有单条“确认 / 拒绝并删除”。
   - `src/app/crm/customer-applications/page.tsx:134`
   - `src/app/crm/customer-applications/page.tsx:638`

3. 现有批量接口明确限制为 `ADMIN`。
   - `src/app/api/crm/customer-applications/batch/route.ts:11`

4. 现有批量接口遇到需要主管复核的申请会直接跳过，并返回“需主管逐条复核，不支持批量操作”。
   - `src/app/api/crm/customer-applications/batch/route.ts:76`

5. 单条复核接口已经允许 `ADMIN` 和 `REGIONAL_MANAGER` 执行 `confirm-review / reject-review`。
   - `src/app/api/crm/customer-applications/[id]/route.ts:93`
   - `src/app/api/crm/customer-applications/[id]/route.ts:117`
   - `src/app/api/crm/customer-applications/[id]/route.ts:157`

## 3. 问题拆解

### 3.1 能力缺口不是单纯 UI 缺按钮

这次不是“后端有能力，只是页面没露出来”。

当前缺口分两层：

1. 页面层没有“待复核”的批量勾选和批量操作条。
2. 后端层没有“待复核”的批量处理动作。

因此不能只补前端按钮，否则会直接撞到接口 403 或能力缺失。

### 3.2 现有两条链路已经分叉

当前系统实际上有两条不同链路：

1. “待创建”链路
   - 面向 `PENDING` 申请
   - 主要动作是 `approve / reject`
   - 当前批量能力存在，但仅限 `ADMIN`

2. “待复核”链路
   - 面向 `autoApproved + supervisor/admin review pending` 的申请
   - 主要动作是 `confirm-review / reject-review`
   - 当前只有单条能力，没有批量能力

后续修复不应把两条链路重新揉成一套模糊动作，而应共享基础设施、保留权限边界。

## 4. 修复目标

### 4.1 P1 目标

1. 给“待复核”补齐批量处理能力。
2. `ADMIN` 和 `REGIONAL_MANAGER` 共用同一套批量复核链路。
3. 单条复核和批量复核共用同一套领域逻辑，避免状态规则和副作用分叉。

### 4.2 不变的边界

以下边界不应被这次修复突破：

1. `approve / reject` 这类“创建客户”的批量处理仍然保持 `ADMIN-only`。
2. 地区经理只获得“批量复核”能力，不获得“批量建客户”能力。
3. 权限边界必须在后端写死，不能依赖前端隐藏。

## 5. 建议方案

### 5.1 总体思路

建议采用“同一批量端点，按动作分权限”的方案。

也就是继续复用现有：

- `POST /api/crm/customer-applications/batch`

但扩展它支持两类动作：

1. `approve` / `reject`
   - 服务“待创建”队列
   - 仅 `ADMIN`

2. `confirm-review` / `reject-review`
   - 服务“待复核”队列
   - `ADMIN` 和 `REGIONAL_MANAGER` 共用

这样能做到：

1. 入口统一
2. 返回结构统一
3. 前端处理统一
4. 权限边界仍然清晰

### 5.2 不建议的方案

1. 新开第二个 `batch-review` API
   - 会让单条、批量、待创建、待复核的入口继续分叉

2. 直接在页面里循环调用单条 PATCH
   - 无法统一汇总结果
   - 并发与部分失败语义差
   - 日志、提示、跳过理由也会更乱

3. 只给地区经理加前端按钮
   - 后端仍无对应批量能力

## 6. 共享链路设计

### 6.1 动作矩阵

1. `approve`
   - 队列：待创建
   - 角色：`ADMIN`

2. `reject`
   - 队列：待创建
   - 角色：`ADMIN`

3. `confirm-review`
   - 队列：待复核
   - 角色：`ADMIN` / `REGIONAL_MANAGER`

4. `reject-review`
   - 队列：待复核
   - 角色：`ADMIN` / `REGIONAL_MANAGER`

### 6.2 按钮文案与 action 映射

为避免“按钮文案”和“接口动作名”在讨论或实现时混淆，建议固定使用下表：

| 按钮文案 | API action | 链路 |
| --- | --- | --- |
| 批量通过 | `approve` | 待创建 |
| 批量驳回 | `reject` | 待创建 |
| 批量确认复核 | `confirm-review` | 待复核 |
| 批量拒绝复核并删除 | `reject-review` | 待复核 |

### 6.3 返回结构

建议统一返回：

```ts
{
  ok: true,
  action: "approve" | "reject" | "confirm-review" | "reject-review",
  approved?: number,
  createRejected?: number,
  confirmed?: number,
  reviewRejected?: number,
  skipped: Array<{ id: string; reason: string }>,
  errors: Array<{ id: string; error: string }>
}
```

说明：

1. `action` 用于让前后端都能明确当前批次的语义。
2. “待创建”动作使用 `approved / createRejected`。
3. “待复核”动作使用 `confirmed / reviewRejected`。
4. `skipped / errors` 两条链路共用。

不建议继续复用同一个 `rejected` 字段承载两条链路：

1. `reject` 的语义是“拒绝创建客户”
2. `reject-review` 的语义是“拒绝复核，并触发客户数据清理”

这两者副作用不同，统计字段应显式区分。

### 6.4 跳过语义

批量复核时需要保留逐条结果，而不是“一条失败全体失败”。

建议统一使用三类结果：

1. 成功
2. 跳过
   - 例如：已处理、无权限、不在当前复核队列
3. 错误
   - 例如：事务失败、清理失败、数据库异常

## 7. 后端修改方案

### 7.1 抽共享 service

建议把单条复核逻辑从：

- `src/app/api/crm/customer-applications/[id]/route.ts`

抽到共享 service，例如：

- `src/lib/crm/customer-application-review-actions.ts`

或等价命名。

### 7.2 service 最少应承接四件事

1. 权限判定
   - `ADMIN` 可复核全部
   - `REGIONAL_MANAGER` 必须逐条校验 reviewer 权限

2. 状态 claim
   - 继续复用当前单条接口的 `updateMany + 条件 claim` 模式
   - 防止并发下重复处理

3. 字段更新
   - `confirm-review` 更新 supervisor/admin/reviewed* 字段
   - `reject-review` 更新状态并写 review note

4. 副作用清理
   - `reject-review` 时复用现有“删除或软删除 auto-created customer / crm profile”的逻辑

### 7.3 建议的 service 形态

建议拆成两层：

1. 单条领域动作
   - `confirmCustomerApplicationReview(...)`
   - `rejectCustomerApplicationReview(...)`

2. 批量编排动作
   - `runBatchCustomerApplicationReview(...)`

这样单条 API 和批量 API 都只负责：

1. 解析请求
2. 校验入口级权限
3. 调用共享 service
4. 返回结果

### 7.4 批量 API 扩展方式

在现有 `src/app/api/crm/customer-applications/batch/route.ts` 中扩动作分支：

1. 保留原有 `approve / reject`
2. 新增 `confirm-review / reject-review`
3. 按动作判断允许角色
4. 每次批量调用只接受一个 `action`，不允许同一次请求中混合多种动作

前端通过不同按钮分别触发不同调用：

1. “批量确认复核” -> `confirm-review`
2. “批量拒绝复核并删除” -> `reject-review`
3. “批量通过” -> `approve`
4. “批量驳回” -> `reject`

建议写成显式分支，不要做宽松 allow-list，例如：

1. `approve / reject` 时要求 `session.user.role === "ADMIN"`
2. `confirm-review / reject-review` 时要求 `role in ["ADMIN", "REGIONAL_MANAGER"]`

### 7.5 地区经理的逐条权限校验

即使用户通过了入口级角色校验，批量复核时仍要逐条校验：

1. 该申请是否属于可复核队列
2. 当前地区经理是否是该申请的 reviewer

推荐直接复用现有 reviewer 解析逻辑，而不是在 batch route 里手写另一套范围判断。

### 7.6 并发安全

单条复核已经采用“claim 成功才继续”的思路，这一层必须保留到批量版。

建议规则：

1. 每条记录独立 claim
2. claim 失败则记为 `skipped`
3. 不因一条 claim 失败中断整个批次
4. 每条记录使用独立 `$transaction`，一条事务失败不影响其余记录

这里应明确选择“逐条独立事务”，而不是“整批一个大事务”：

1. 单条 `reject-review` 已经包含 claim + cleanup 的完整事务边界
2. cleanup 失败时只应回滚当前申请，不应回滚同批已经成功处理的十几条记录

### 7.7 `reject-review` 的 cleanup 边界

批量 `reject-review` 的 cleanup 逻辑应与单条完全一致，逐条独立执行。

不建议在这次改造中引入“批量删除优化”，原因是：

1. 单条逻辑已经覆盖了 CRM profile 删除、customer 删除/软删除、以及依赖计数判断
2. 这些逻辑边界较重，批量优化很容易引入新的遗漏条件
3. 当前优先级应是行为一致性，而不是批量清理吞吐优化

因此推荐策略是：

1. 一条申请一条事务
2. 一条申请内完整执行原有 cleanup
3. 如果其中一条 cleanup 失败，仅将该条记入 `errors`

## 8. 前端修改方案

### 8.1 页面模式

页面仍然保留现有三视图：

1. `view=pending`
2. `view=review`
3. `view=all`

但批量能力要从“仅 pending”扩展成“双模式”：

1. `pending`
   - 保留现有 admin 批量通过 / 批量驳回

2. `review`
   - 新增共享批量复核条
   - `ADMIN` / `REGIONAL_MANAGER` 都显示

### 8.2 待复核批量操作条

建议在 `view=review` 下新增：

1. “全选本页待复核”
2. “批量确认复核”
3. “批量拒绝复核并删除”
4. “清空选择”

当前页面没有分页机制，列表是一次性加载。

因此这里的“全选本页待复核”在当前实现下等价于：

1. 全选当前筛选结果中的全部待复核记录

文案上继续写“本页”可以接受，但文档需要明确这一点，避免后续加分页后误沿用旧语义。

### 8.3 选择范围

待复核批量选择建议只允许选中以下记录：

1. `autoApproved = true`
2. 当前仍处于待复核状态
3. 当前用户对该条有复核权限

不满足条件的卡片：

1. 不显示勾选框
2. 或显示 disabled 勾选框并附带原因提示

### 8.4 备注规则

建议区分两种动作：

1. `confirm-review`
   - 备注可选

2. `reject-review`
   - 备注建议改为必填
   - 因为这是 destructive flow，后续追责和审计更依赖理由

批量 `reject-review` 的备注收集方式建议采用：

1. 弹出一个统一确认弹窗
2. 在弹窗中输入一条统一备注
3. 该备注应用到本次选中的全部申请

不建议做逐条输入，原因是：

1. 批量操作的效率会被完全抵消
2. 前端交互复杂度明显变高
3. 与当前“批量操作一次只接受一个 action”的模型不匹配

确认文案建议明确提示：

1. 当前共选中 N 条申请
2. 这些申请将使用同一条拒绝理由
3. 该操作会触发“拒绝复核并删除 / 软删除自动创建数据”

### 8.5 结果反馈

批量执行后前端 toast 建议统一输出：

1. 成功数
2. 跳过数
3. 失败数

如果失败或跳过较多，再展示前若干条原因摘要。

## 9. 权限与产品边界

### 9.1 这次放开的能力

这次仅建议放开：

1. 地区经理批量确认复核
2. 地区经理批量拒绝复核并删除

### 9.2 这次不放开的能力

这次不建议放开：

1. 地区经理批量创建客户
2. 地区经理批量绑定已有客户
3. 地区经理修改“待创建”队列的批量规则

### 9.3 需要产品确认的点

有一个需要先确认的产品点：

1. `reject-review` 是否必须填写备注

从技术和审计角度，我建议“批量拒绝复核并删除”强制备注，比当前单条的“可空备注”更稳。

## 10. 实施顺序

### 10.1 Phase 1：抽共享复核逻辑

1. 抽出单条 `confirm-review / reject-review` 共享 service
2. 让单条 API 改为调用共享 service
3. 保证行为与现状完全一致

### 10.2 Phase 2：扩批量 API

1. 扩 `POST /api/crm/customer-applications/batch`
2. 新增 `confirm-review / reject-review`
3. 接入逐条权限校验与逐条结果汇总

### 10.3 Phase 3：接前端批量复核 UI

1. `view=review` 加勾选与全选
2. `ADMIN / REGIONAL_MANAGER` 共用批量操作条
3. 接入统一结果 toast 与刷新逻辑

### 10.4 Phase 4：收口验证

1. 清理重复状态判断
2. 统一按钮显隐条件
3. 校验单条 / 批量在结果提示上的一致性

## 11. 验证清单

### 11.1 Admin 场景

1. `ADMIN` 在 `view=review` 可批量确认复核
2. `ADMIN` 在 `view=review` 可批量拒绝复核并删除
3. `ADMIN` 在 `view=pending` 仍可批量通过 / 批量驳回

### 11.2 地区经理场景

1. `REGIONAL_MANAGER` 在 `view=review` 可勾选自己辖区内待复核记录
2. `REGIONAL_MANAGER` 在 `view=review` 不可勾选无权限记录
3. `REGIONAL_MANAGER` 访问批量复核接口时，混入无权限 id 会被逐条跳过，不会整批放行
4. `REGIONAL_MANAGER` 访问 `approve / reject` 批量动作仍返回 403

### 11.3 并发与异常场景

1. 两人同时复核同一条，后到者应收到“已处理 / skipped”
2. 批量里部分成功、部分失败时，结果汇总正确
3. `reject-review` 的客户 / CRM 档案清理行为与单条一致

### 11.4 UI 场景

1. 切换 `pending / review / all` 时，选择状态能正确清空
2. 批量条只在对应视图和权限下显示
3. 手机端批量操作条不挤压、不遮挡

## 12. 回滚策略

如果批量复核上线后出现问题，建议按以下顺序快速回退：

1. 前端先隐藏 `view=review` 的批量复核条
2. 后端保留新动作分支但返回 403，或仅保留 `ADMIN`
3. 单条复核链路不回退，保证基本业务不断

这样可以把影响面控制在“新加的批量能力”，不伤到原有单条复核。

## 13. 最终建议

建议的最终形态是：

1. 单条复核和批量复核共用同一套领域 service
2. `ADMIN` 和 `REGIONAL_MANAGER` 共用同一个批量复核 API 链路
3. “待复核”支持批量；“待创建”仍保持 admin 专属

这是当前改动面最小、权限边界最清晰、后续最容易维护的方案。
