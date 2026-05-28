# CRM 有效代表归属候选集优化执行方案

## 背景

当前有效代表归属口径已经统一为：

```text
客户显式分配 > 院区绑定 > 单位绑定 > 无归属
```

现有实现为了保证正确性，部分入口会先读取所有 `archived = false` 的 CRM profile，再调用 `resolveEffectiveCustomerRepresentatives()` 批量解析，最后按 `effective.ownerUserId` 过滤。

这种实现语义正确，但在单代表周报、订单 / 财务 scope、客户选择项等高频入口中存在性能浪费：

- 查询范围是全量 CRM profile，而实际只需要某个代表或一组代表可能归属的客户。
- 数据量增长后，每次请求都会重复做全量 profile 查询、全量绑定解析和全量过滤。
- 周报类接口只看一个代表，却仍需要扫描全部 CRM 资料。

本方案目标是在不改变归属口径的前提下，把流程优化为：

```text
按代表相关显式分配 / 院区绑定 / 单位绑定粗筛候选客户
  -> 调用现有 effective resolver 终筛
  -> 返回最终归属结果
```

核心原则：候选集只负责缩小范围，最终归属仍由 resolver 裁决。

---

## 目标

### 功能目标

- 保持有效归属口径不变。
- 所有 scoped 可见性 helper 仍以 `effective.ownerUserId` 为最终判断。
- 单代表 / 多代表查询不再扫描全量 CRM profile。
- 区域经理一次性解析自己和下辖代表，避免按代表重复查询。

### 非目标

- 不修改 Prisma schema。
- 不引入缓存表或物化归属表。
- 不改变客户主数据编辑权限边界。
- 不改动显式分配、回收、单位绑定的业务状态流转。

---

## 新增 Helper 设计

文件：

```text
src/lib/crm/customer-effective-representative.ts
```

### 类型定义

新增类型：

```ts
export type EffectiveCustomerForOwner = EffectiveCustomerRepresentative & {
  ownerUserId: string;
};
```

说明：

- 复用现有 `EffectiveCustomerRepresentative` 的字段。
- 只返回已经命中某个 owner 的客户，因此 `ownerUserId` 在该类型中为非空。

### 候选客户粗筛

新增函数：

```ts
export async function getCandidateCustomerIdsForEffectiveOwners(
  ownerUserIds: string[],
  db: DbLike = prisma,
): Promise<string[]>
```

职责：

- 输入一组销售 userId。
- 查询这些 userId 可能归属的 customerId。
- 只做粗筛，不保证最终归属。
- 返回去重后的 customerId 列表。

候选来源：

| 来源 | 查询条件 | 说明 |
| --- | --- | --- |
| 显式分配 | `ownerUserId in ownerUserIds` + `assignmentStatus = ASSIGNED` | 显式分配永远优先 |
| 院区绑定 | 这些 owner 对应 representative 的 active site bindings | 查 site 下未显式分配客户 |
| 单位绑定 | 这些 owner 对应 representative 的 active org bindings | 查 org 下未显式分配客户 |

统一过滤：

- `CrmCustomerProfile.archived = false`
- `Customer.deleted = false`
- fallback 候选必须 `assignmentStatus != ASSIGNED`

注意：

- 单位绑定候选不能加 `organizationSiteId = null`。
- 有院区但院区无绑定的客户需要回退单位绑定。
- 单位绑定粗筛可能捞到“院区绑定给别人”的客户，这是允许的，终筛会排除。

### 最终解析并分组

新增函数：

```ts
export async function resolveEffectiveCustomersForOwners(
  ownerUserIds: string[],
  db: DbLike = prisma,
): Promise<Map<string, EffectiveCustomerForOwner[]>>
```

职责：

1. 调用 `getCandidateCustomerIdsForEffectiveOwners(ownerUserIds)` 得到候选客户。
2. 调用现有 `resolveEffectiveCustomerRepresentatives(candidateCustomerIds, db)`。
3. 仅保留 `effective.ownerUserId in ownerUserIds` 的结果。
4. 按 `ownerUserId` 分组返回。

返回示例：

```ts
Map {
  "user_rep_1" => [
    {
      customerId: "cust_a",
      ownerUserId: "user_rep_1",
      representativeId: "rep_1",
      representativeName: "张三",
      source: "EXPLICIT_ASSIGNMENT",
      anchorAt: Date,
    },
  ],
}
```

空结果语义：

- `ownerUserIds = []` 返回空 Map。
- 未命中任何候选返回空 Map。
- 调用方不得把空 Map 解释成 ADMIN 全量。

---

## 候选粗筛实现细节

### Step 1：ownerUserIds 映射到 representativeIds

通过 `User.email` 与 `Representative.email` 关联：

```ts
const users = await db.user.findMany({
  where: {
    id: { in: ownerUserIds },
    role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] },
  },
  select: { id: true, email: true },
});

const reps = await db.representative.findMany({
  where: {
    email: { in: users.map((u) => u.email).filter(Boolean) },
    archived: false,
  },
  select: { id: true, email: true },
});
```

构建映射：

```ts
ownerUserId -> representativeId
representativeId -> ownerUserId
```

### Step 2：查询 active bindings

```ts
const bindings = await db.representativeOrganization.findMany({
  where: {
    representativeId: { in: representativeIds },
    status: "ACTIVE",
    organizationId: { not: null },
  },
  select: {
    representativeId: true,
    organizationId: true,
    organizationSiteId: true,
  },
});
```

拆分：

- `siteBindingSiteIds`: `organizationSiteId != null`
- `orgBindingOrgIds`: `organizationSiteId = null`

### Step 3：查询候选 profiles

显式分配：

```ts
const explicitProfiles = await db.crmCustomerProfile.findMany({
  where: {
    archived: false,
    assignmentStatus: "ASSIGNED",
    ownerUserId: { in: ownerUserIds },
    sourceCustomer: { deleted: false },
  },
  select: { sourceCustomerId: true },
});
```

院区 fallback：

```ts
const siteFallbackProfiles = siteBindingSiteIds.length > 0
  ? await db.crmCustomerProfile.findMany({
      where: {
        archived: false,
        assignmentStatus: { not: "ASSIGNED" },
        sourceCustomer: {
          deleted: false,
          organizationSiteId: { in: siteBindingSiteIds },
        },
      },
      select: { sourceCustomerId: true },
    })
  : [];
```

单位 fallback：

```ts
const orgFallbackProfiles = orgBindingOrgIds.length > 0
  ? await db.crmCustomerProfile.findMany({
      where: {
        archived: false,
        assignmentStatus: { not: "ASSIGNED" },
        sourceCustomer: {
          deleted: false,
          organizationId: { in: orgBindingOrgIds },
        },
      },
      select: { sourceCustomerId: true },
    })
  : [];
```

去重：

```ts
return [
  ...new Set([
    ...explicitProfiles.map((p) => p.sourceCustomerId),
    ...siteFallbackProfiles.map((p) => p.sourceCustomerId),
    ...orgFallbackProfiles.map((p) => p.sourceCustomerId),
  ]),
];
```

---

## 替换调用点

### 第一阶段：权限 helper

文件：

```text
src/lib/crm/permissions.ts
```

替换函数：

- `getEffectiveCrmVisibleCustomerIds()`
- `getEffectiveCrmVisibleProfileIds()`

新流程：

1. ADMIN / USER 仍返回 `null`，表示全量可见。
2. REPRESENTATIVE 得到 `[session.user.id]`。
3. REGIONAL_MANAGER 得到 `[managerUserId, ...managedRepUserIds]`。
4. 调用 `resolveEffectiveCustomersForOwners(ownerUserIds)`。
5. `getEffectiveCrmVisibleCustomerIds()` 返回 customerId Set。
6. `getEffectiveCrmVisibleProfileIds()` 根据 customerId Set 再查 profile ids。

收益：

- `/api/crm/profiles`
- `/api/customers/list?crmScope=true`
- `/api/crm/follow-ups`
- `/api/crm/relations`
- `/api/orders`
- `/api/finance/*`

这些已经复用 visible helper 的入口都会减少全量扫描。

### 第二阶段：代表周报

文件：

```text
src/app/api/crm/representatives/[representativeId]/report/route.ts
```

替换当前全量 profile 解析逻辑：

```ts
const ownerCustomerMap = await resolveEffectiveCustomersForOwners([userId]);
const effectiveCustomers = ownerCustomerMap.get(userId) ?? [];
const effectiveCustomerIds = effectiveCustomers.map((item) => item.customerId);
```

新客户统计：

```ts
const newCustomerIds = effectiveCustomers
  .filter((item) => item.anchorAt && item.anchorAt >= periodStart && item.anchorAt < periodEnd)
  .map((item) => item.customerId);
```

订单统计继续使用：

```ts
orderedAt ?? confirmedAt ?? createdAt
```

### 第三阶段：代表运营列表

文件：

```text
src/app/api/crm/representatives/route.ts
```

当前代表运营列表需要统计所有代表，仍然可能需要覆盖全部销售归属客户。

优化方式：

1. 先得到所有代表 userId。
2. 调用 `resolveEffectiveCustomersForOwners(allOwnerUserIds)`。
3. 直接得到 owner -> customerIds 分组。
4. 后续生命周期、沟通、订单统计基于这些 customerIds/profileIds。

该阶段收益低于单代表周报，但能消除重复归属实现。

---

## 正确性约束

必须保留以下约束：

- 粗筛结果不能直接作为最终归属。
- 所有对外可见性必须以 `resolveEffectiveCustomerRepresentatives()` 的结果为准。
- 显式分配客户不能被单位 / 院区绑定覆盖。
- 院区绑定优先于单位绑定。
- 单位绑定必须覆盖“有院区但院区无绑定”的客户。
- 归档 profile 不参与 CRM 可见性。
- 删除 customer 不参与候选集。

---

## 性能预期

### 优化前

单代表周报：

```text
查所有 archived=false profile
-> resolve 所有 customer
-> 过滤 ownerUserId
```

复杂度接近全量 CRM 客户数。

### 优化后

单代表周报：

```text
查该代表显式分配客户
查该代表绑定的院区 / 单位
查这些范围下未显式分配客户
-> resolve 候选 customer
-> 终筛 ownerUserId
```

复杂度接近该代表相关客户数。

---

## 风险与防护

| 风险 | 说明 | 防护 |
| --- | --- | --- |
| 候选粗筛漏客户 | 会导致可见客户缺失 | 单位 fallback 不加 `organizationSiteId = null` |
| 候选粗筛多捞客户 | 可能包含别的代表院区客户 | resolver 终筛排除 |
| 空 Set 被误当全量 | scoped 用户无客户时越权 | helper 明确空 Map / 空 Set 语义 |
| 区域经理漏自己 | 区域经理也可能是销售 owner | ownerUserIds 包含 managerUserId |
| 性能回退 | 多入口重复解析同一组 owner | 第一版接受，后续可加 request-level cache |

---

## 验收用例

构造以下客户：

| 客户 | 条件 | 预期归属 |
| --- | --- | --- |
| A | 显式分配给代表 1，单位绑定代表 2 | 代表 1 |
| B | 未分配，有院区绑定代表 2，单位绑定代表 3 | 代表 2 |
| C | 未分配，有院区但院区无绑定，单位绑定代表 3 | 代表 3 |
| D | 未分配，无绑定 | 无归属 |
| E | 显式分配给代表 1，院区绑定代表 2 | 代表 1 |

检查入口：

- `/api/crm/profiles`
- `/api/customers/list?crmScope=true`
- `/api/crm/follow-ups`
- `/api/crm/relations`
- `/api/orders`
- `/api/finance/customers`
- `/api/crm/representatives/[representativeId]/report`
- `/api/crm/representatives/[representativeId]/report/interactions`

验收标准：

- A/E 只归代表 1。
- B 只归代表 2。
- C 只归代表 3。
- D 不出现在销售 scoped 视图中。
- 区域经理能看到自己和下辖代表的 A/B/C/E。
- ADMIN / USER 语义不变。

---

## 执行顺序

1. 在 `customer-effective-representative.ts` 新增候选粗筛和 owner 分组 helper。
2. 替换 `crm/permissions.ts` 的 visible customer/profile helper。
3. 替换代表周报 GET 的全量 profile 解析。
4. 可选替换代表运营列表的 owner 分组逻辑。
5. 跑类型检查、lint、build。
6. 用 demo 数据验证上面的 5 类客户。

验证命令：

```bash
npx tsc --noEmit
npm run lint
npm run build
```

