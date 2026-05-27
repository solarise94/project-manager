# CRM 客户有效代表归属统一执行方案

## 背景

当前系统里存在两套不同概念：

- 客户显式分配：`CrmCustomerProfile.ownerUserId` + `assignmentStatus`
- 代表单位绑定：`RepresentativeOrganization` 绑定代表与单位 / 院区

现有代表运营指标、CRM 可见性、订单 / 项目代表同步主要依赖客户显式分配。单位绑定更多用于代表申请和单位关系维护，并没有作为代表运营指标的 fallback 归属来源。

目标是统一“这个客户算哪个代表”的口径：

> 客户显式分配优先；未显式分配时回退到院区 / 单位绑定。

---

## 目标口径

### 归属优先级

| 优先级 | 来源 | 命中条件 | 结果 |
| --- | --- | --- | --- |
| 1 | 客户显式分配 | `CrmCustomerProfile.assignmentStatus = ASSIGNED`，且 `ownerUserId` 对应有效销售代表 | 算给显式分配代表 |
| 2 | 院区绑定 | 客户有 `organizationSiteId`，且该院区存在 `RepresentativeOrganization.status = ACTIVE` | 算给院区绑定代表 |
| 3 | 单位绑定 | 客户有 `organizationId`，且单位级绑定 `organizationSiteId = null`、`status = ACTIVE` | 算给单位绑定代表 |
| 4 | 无归属 | 以上均未命中 | 不计入任何代表运营指标 |

### 未显式分配定义

以下状态均视为“未显式分配”，可以走单位 / 院区 fallback：

- `UNASSIGNED`
- `RECALLED`
- `RECALL_CANDIDATE`
- 任何非 `ASSIGNED` 状态

原因：`RECALL_CANDIDATE` 虽然可能保留旧 `ownerUserId`，但业务上已经不应继续稳定算给原负责人。

### 院区与单位优先级

院区绑定优先于单位绑定。

示例：

| 客户信息 | 绑定情况 | 有效代表 |
| --- | --- | --- |
| 有院区 | 院区绑定 A，单位绑定 B | A |
| 有院区 | 院区无绑定，单位绑定 B | B |
| 无院区 | 单位绑定 B | B |
| 显式分配给 C | 院区绑定 A，单位绑定 B | C |

---

## 统一归属解析器

新增模块：

```text
src/lib/crm/customer-effective-representative.ts
```

建议导出：

```ts
export type EffectiveRepresentativeSource =
  | "EXPLICIT_ASSIGNMENT"
  | "SITE_BINDING"
  | "ORG_BINDING"
  | "NONE";

export type EffectiveCustomerRepresentative = {
  customerId: string;
  representativeId: string | null;
  representativeName: string | null;
  ownerUserId: string | null;
  source: EffectiveRepresentativeSource;
  anchorAt: Date | null;
};

export async function resolveEffectiveCustomerRepresentative(
  customerId: string,
  db?: DbLike,
): Promise<EffectiveCustomerRepresentative>;

export async function resolveEffectiveCustomerRepresentatives(
  customerIds: string[],
  db?: DbLike,
): Promise<Map<string, EffectiveCustomerRepresentative>>;
```

### ownerUserId 规则

| 来源 | `ownerUserId` |
| --- | --- |
| `EXPLICIT_ASSIGNMENT` | CRM profile 的 `ownerUserId` |
| `SITE_BINDING` | 绑定代表 email 对应的销售 `User.id` |
| `ORG_BINDING` | 绑定代表 email 对应的销售 `User.id` |
| `NONE` | `null` |

销售用户要求：

- `User.email = Representative.email`
- `User.role in (REPRESENTATIVE, REGIONAL_MANAGER)`
- `Representative.archived = false`

### anchorAt 规则

| 来源 | `anchorAt` |
| --- | --- |
| `EXPLICIT_ASSIGNMENT` | `profile.assignedAt ?? profile.createdAt` |
| `SITE_BINDING` | `max(profile.createdAt, binding.reviewedAt ?? binding.createdAt)` |
| `ORG_BINDING` | `max(profile.createdAt, binding.reviewedAt ?? binding.createdAt)` |
| `NONE` | `null` |

`anchorAt` 用于转化归因，避免把绑定 / 分配之前已经发生的首单算给当前代表。

---

## 代表运营指标改造

涉及文件：

- `src/app/api/crm/representatives/route.ts`
- `src/app/api/crm/representatives/[representativeId]/route.ts`
- `src/app/api/crm/admin-analytics/route.ts`

### 当前逻辑

当前主要按：

```ts
profile.ownerUserId + profile.assignmentStatus === "ASSIGNED"
```

分组统计。

### 目标逻辑

改为：

```ts
effective.ownerUserId
```

步骤：

1. 查询 CRM profiles 和对应 `sourceCustomerId`
2. 批量调用 `resolveEffectiveCustomerRepresentatives(customerIds)`
3. 过滤 `effective.ownerUserId != null`
4. 按 `effective.ownerUserId` 分组
5. 指标计算使用 lifecycle summary + effective anchor

### 指标归属

| 指标 | 分组依据 | 时间锚点 |
| --- | --- | --- |
| 客户数 | `effective.ownerUserId` | 无 |
| 活跃客户数 | `effective.ownerUserId` + `getEffectiveCrmLifecycleStage(summary) === ACTIVE` | 无 |
| 30 / 90 天转化率 | `effective.ownerUserId` | `effective.anchorAt` |
| 30 / 90 天复购率 | `effective.ownerUserId` | `lastOrderAt` |
| 休眠 / 预警 | `effective.ownerUserId` | lifecycle summary |

注意：不要再用 `summary.ownerUserId` 作为代表运营归属，因为 fallback 场景下 profile owner 可能不是有效代表。

---

## 订单 / 项目代表同步

涉及文件：

- `src/lib/crm/customer-owner-representative.ts`
- `src/lib/crm/customer-representative-sync.ts`
- `src/lib/business/customer-context.ts`
- 订单导入 / 订单创建 / 项目创建相关调用点

### 当前逻辑

`resolveCustomerRepresentative(customerId)` 只通过 CRM profile owner 反推代表。

### 目标逻辑

`resolveCustomerRepresentative(customerId)` 改为调用 `resolveEffectiveCustomerRepresentative(customerId)`。

结果：

| 场景 | 订单 / 项目 representative |
| --- | --- |
| 客户显式分配给 A | A |
| 客户未分配，院区绑定 B | B |
| 客户未分配，单位绑定 C | C |
| 客户无有效归属 | null |

### 同步触发点

| 事件 | 动作 |
| --- | --- |
| 客户被显式分配 | 重算该客户订单 / 项目代表 |
| 客户被收回 / 取消分配 | 重新按 fallback 归属重算 |
| 单位绑定变为 ACTIVE | 批量重算该单位下未显式分配客户 |
| 院区绑定变为 ACTIVE | 批量重算该院区下未显式分配客户 |
| 单位 / 院区绑定归档或拒绝 | 批量重算受影响未显式分配客户 |
| 客户 `organizationId` / `organizationSiteId` 变化 | 重算该客户 |
| 订单导入绑定 customerId | 使用 effective representative 写入订单代表 |

---

## CRM 权限与可见性

涉及文件：

- `src/lib/crm/permissions.ts`
- `src/app/api/crm/profiles/route.ts`
- `src/app/api/crm/customers` 相关列表
- CRM 详情、互动、拜访、跟进等读写入口

### 推荐口径

代表可见客户：

1. 显式分配给自己的客户
2. 未显式分配，但院区绑定给自己的客户
3. 未显式分配，且无院区绑定命中，但单位绑定给自己的客户

区域经理可见客户：

1. 下辖代表显式分配客户
2. 下辖代表通过院区 / 单位绑定 fallback 得到的客户

### 写权限建议

第一版建议：

| 归属来源 | 可见 | 可创建互动 / 拜访 / 跟进 |
| --- | --- | --- |
| `EXPLICIT_ASSIGNMENT` | 是 | 是 |
| `SITE_BINDING` | 是 | 是 |
| `ORG_BINDING` | 是 | 是 |
| `NONE` | 否 | 否 |

如果担心 fallback 客户被多个代表误操作，可以改为：

- fallback 客户可见
- 需要先“认领 / 显式分配”后才能写互动

该取舍需要产品确认。

### 实现建议

简单 Prisma `where` 很难完整表达“显式分配优先、未分配再 fallback”的逻辑。

建议：

1. 列表类接口先查候选客户
2. 批量调用 effective resolver
3. 按有效归属做精确过滤

对高频列表需要关注性能：

- resolver 必须批量查询
- 不允许每行查一次绑定
- 后续如数据量变大，再考虑物化缓存字段

---

## 单位绑定变更后的重算

涉及文件：

- `src/app/api/crm/representative-organizations/route.ts`
- `src/app/api/crm/representative-organizations/[id]/route.ts`
- `src/app/api/organization-reviews/[id]/route.ts`

新增 helper：

```ts
syncEffectiveRepresentativeLinksForOrganization(params)
syncEffectiveRepresentativeLinksForCustomer(customerId)
```

建议放在：

```text
src/lib/crm/customer-representative-sync.ts
```

### 重算范围

| 绑定变化 | 重算范围 |
| --- | --- |
| 单位级绑定变 ACTIVE | `Customer.organizationId = binding.organizationId` 且非显式分配 |
| 院区绑定变 ACTIVE | `Customer.organizationSiteId = binding.organizationSiteId` 且非显式分配 |
| 单位 / 院区绑定归档 | 原绑定范围内非显式分配客户 |
| 新单位审核通过并激活绑定 | 新单位范围内非显式分配客户 |

显式分配客户不受单位绑定变化影响。

---

## 历史数据回填

不建议把 fallback 结果写入 `CrmCustomerProfile.ownerUserId`。

原因：

- `ownerUserId` 表示显式分配
- fallback 是动态归属
- 写入 owner 会丢失“这是单位绑定 fallback”的来源信息

建议只回填：

- `Order.representativeId`
- `Project.representativeId`
- `Project.representative`

回填脚本逻辑：

1. 扫所有未删除客户
2. 调用 `resolveEffectiveCustomerRepresentatives`
3. 批量更新客户关联订单 / 项目代表快照
4. 输出按 `source` 分组的统计

---

## 分阶段执行

### Phase 1：统一解析器

改动：

- 新增 `customer-effective-representative.ts`
- 改 `resolveCustomerRepresentative()` 内部实现
- 保持旧函数签名兼容

验收：

- 显式分配优先
- 院区绑定优先于单位绑定
- 单位绑定 fallback 生效
- `source` 和 `anchorAt` 正确

### Phase 2：代表运营指标切换

改动：

- 代表列表 API 使用 effective owner 分组
- 代表详情 API 使用 effective owner 分组
- admin analytics 使用 effective owner 分组

验收：

- 未分配但单位绑定的客户进入代表客户数
- fallback 客户的订单计入代表 30 / 90 天转化率、复购率
- 显式分配客户不受单位绑定影响

### Phase 3：订单 / 项目快照同步

改动：

- `customer-representative-sync.ts` 改为统一重算
- 单位绑定状态变化后触发批量同步
- 客户单位 / 院区变化后触发单客户同步

验收：

- 订单导入后代表快照正确
- 单位绑定激活后，历史未显式分配客户订单代表能重算
- 显式分配客户不被单位绑定覆盖

### Phase 4：CRM 可见性与操作权限

改动：

- CRM profile 列表支持 fallback 可见
- 详情、互动、拜访、跟进权限按 effective representative 判断
- 区域经理包含下辖 fallback 客户

验收：

- 代表能看到自己单位绑定 fallback 的客户
- 代表不能看到其他代表显式分配客户
- 区域经理能看到下辖代表 fallback 客户

### Phase 5：回填与监控

改动：

- 增加一次性 backfill 脚本
- 输出归属来源统计
- 上线后抽样核对代表运营指标

验收：

- 订单 / 项目代表快照与 effective resolver 一致
- 代表运营页与客户列表可见性一致

---

## 验收用例

| 用例 | 预期 |
| --- | --- |
| 客户显式分配给 A，单位绑定 B | 算给 A |
| 客户显式分配给 A，院区绑定 B | 算给 A |
| 客户未分配，院区绑定 A，单位绑定 B | 算给 A |
| 客户未分配，院区无绑定，单位绑定 B | 算给 B |
| 客户 `RECALL_CANDIDATE`，单位绑定 B | 算给 B |
| 客户无 profile，但有单位绑定 | 不进入 CRM 代表运营，除非创建 CRM profile |
| 单位绑定从 B 改为 C | 未显式分配客户重算到 C |
| 显式分配客户被收回 | 重新按院区 / 单位绑定 fallback |
| 首单早于 `anchorAt` | 不计入该代表转化 |
| 最近订单在 30 / 90 天内 | 按 effective representative 计入复购分母 / 分子 |

---

## 风险与注意事项

1. 权限查询复杂度会上升
   - 需要批量 resolver，避免 N+1 查询。

2. 指标可能短期跳变
   - 未分配但单位绑定的客户会开始计入代表运营指标。

3. fallback 写权限需要产品确认
   - 第一版建议可见且可操作；如果需要更严格，可以改成可见但需认领。

4. 不要把 fallback 写进 `ownerUserId`
   - 否则会把动态归属误变成显式分配，后续无法解释来源。

5. `anchorAt` 必须使用 effective 来源
   - 转化率不能继续使用 profile owner 的 `assignedAt`。

---

## 最终口径一句话

客户显式分配是强归属；未显式分配时，先按院区绑定，再按单位绑定解析有效代表。代表运营指标、订单 / 项目代表快照、CRM 可见性都使用有效代表；`CrmCustomerProfile.ownerUserId` 只表示显式分配，不承载 fallback 结果。
