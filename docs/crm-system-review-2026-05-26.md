# CRM 系统审阅报告 (2026-05-26)

审阅范围：`src/app/api/crm/`（45 个路由文件）、`src/lib/crm/`（14 个库文件）、`src/components/crm/`（17 个组件）、`src/app/crm/`（13 个页面）以及外部调用点。

---

## 执行记录（2026-05-26）

### 已完成

- `#1` Profile 列表分页回退：已恢复为 DB 分页 + lifecycle 条件下的轻量 ID 扫描，不再全量 `include` 后做内存分页。
- `#2` `scanDormantCrmProfiles` N+1：已改为批量 `getCrmLifecycleSummariesForCustomers(...)`。
- `#3` `customer-pool/scan` N+1：已改为按 profileId 批量拉取最近签到与最近拜访互动，再在内存中归并。
- `#4` `admin-analytics` / `representatives` 按代表重复查库：已改为先批量收集 profile / customer，再统一聚合 lifecycle 与 communication metrics。
- `#5` Dashboard 全量 profile 拉取：已改为直接 `count` / `groupBy` / relation filter 聚合，不再先取全量 profile 列表。
- `#6` `getCrmLifecycleSummariesForCustomers` 历史订单全量加载：已改为 DB 级聚合（`COUNT / SUM / MAX(COALESCE(...))`）。
- `#7` 互动记录创建与 lifecycle 同事务：已拆开为“先写 interaction，再 best-effort sync lifecycle”。
- `#8` 订单及导入链路 lifecycle sync 未兜底：已统一改为 best-effort，并补日志。
- `#9` `follow-ups/[id]` PATCH 在事务内调用 lifecycle sync：已拆到事务外，失败仅记日志。

### 已确认并已落地

- `#10` `syncCrmLifecycleForCustomer`：改为“无变化不写库”。
- `#11` `CrmCustomerProfile.lastOrderAt`：保留字段但弱化缓存依赖，读路径优先实时 lifecycle 聚合，不再回退使用缓存值。
- `#15` Profile 列表排序：先支持 `lastOrderAt`、`validOrderCount` 两个 lifecycle 排序字段。
- `#16` 沟通完成率：不再使用系统自动生成的任务完成率指标，当前仅保留任务量/已完成量等运营观察值，后续如需考核口径由 ADMIN 单独定义。

### 版本控制提醒

- `#12` 提到的 internal cron 路由目前在工作区已存在，但仍需和部署脚本改动一起提交，才算从仓库状态上彻底关闭。

---

## 一、性能问题

### 1. [CRITICAL] Profile 列表 API 全表扫描 + 内存分页

**文件**: `src/app/api/crm/profiles/route.ts:113-143`

`findMany` 未设置 `skip`/`take`，先将全部 profile 加载到内存，enrichment + filter + slice 后才分页。`total` 反映内存过滤后的数量而非 DB 真实总数。

影响：
- 客户量大时内存占用 / 响应时间线性增长
- 前端分页器显示错误页数（因为 total 只在当前已加载数据中计算）

对比：`customer-pool/route.ts` 正确地使用了 DB 级分页 (`skip`/`take`)，说明这是引入 lifecycle enrichment 时的回归。

**修复方向**：先做 DB 分页和可下推的筛选，再对当前页做 lifecycle enrichment。`hasOrder`/`dormantRisk` 等 enrichment 后才能判断的筛选条件，可先扫描 lifecycle 关联表转为 customerId 集合，再传入 DB 查询。

### 2. [CRITICAL] `scanDormantCrmProfiles` N+1 查询

**文件**: `src/lib/crm/lifecycle.ts:459-461`

```typescript
for (const profile of profiles) {
  const summary = await getCrmLifecycleSummaryByCustomerId(profile.sourceCustomerId, db);
```

循环内每次调用 `getCrmLifecycleSummaryByCustomerId`（内部执行 3 个独立查询：order aggregate + interaction aggregate + task aggregate）。N 个 profile = 3N 次查询。同文件已有 `getCrmLifecycleSummariesForCustomers` 批量版本可直接使用。

### 3. [CRITICAL] `customer-pool/scan` N+1 查询

**文件**: `src/app/api/crm/customer-pool/scan/route.ts:32-50`

```typescript
for (const p of profiles) {
  const [lastCheckin, lastVisitInteraction] = await Promise.all([
    prisma.crmVisitCheckin.findFirst({ where: { profileId: p.id, status: "COMPLETED" }, ... }),
    prisma.crmInteraction.findFirst({ where: { profileId: p.id, type: "VISIT" }, ... }),
  ]);
```

每个 profile 做 2 次独立查询。应改为按 profileId 批量查询。

### 4. [HIGH] admin-analytics 和 representatives 列表：每个代表各做一次批量查询

**文件**:
- `src/app/api/crm/admin-analytics/route.ts:133-197`
- `src/app/api/crm/representatives/route.ts:189-265`

对每个 representative 单独调用 `getCrmLifecycleSummariesForCustomers` + `getCrmCommunicationMetrics`。N 个代表 = N 次批量查询 + N 次 communication metrics 查询。应收集所有代表的 customerIds 做一次批量查询，再按 ownerUserId 拆分。

### 5. [MEDIUM] Dashboard 每次加载拉取全部 profile

**文件**: `src/app/api/crm/dashboard/route.ts:28`

`prisma.crmCustomerProfile.findMany({ where: { ...roleWhere, archived: false }, select: { id: true, sourceCustomerId: true } })` 无 limit。对 ADMIN 在有 10000+ profile 时每次 dashboard 加载全量 ID 列表。

### 6. [MEDIUM] `getCrmLifecycleSummariesForCustomers` 订单查询无日期边界

**文件**: `src/lib/crm/lifecycle.ts:169-185`

```typescript
db.order.findMany({
  where: { customerId: { in: uniqueIds }, deleted: false, archived: false, status: { in: ["CONFIRMED", "CLOSED"] } },
  select: { customerId: true, orderedAt: true, confirmedAt: true, createdAt: true, totalAmount: true, financeAmountOverride: true },
})
```

对每个 customer 加载全部历史订单用于内存聚合。一个 5 年客户可能有数百条订单。但调用方只需 `validOrderCount`、`lastOrderAt`、`validOrderAmount` 三个聚合值，可用 Prisma `groupBy` 替代。

---

## 二、功能性 Bug

### 7. [HIGH] 互动记录创建与 lifecycle 同步在同一事务内

**文件**: `src/app/api/crm/profiles/[id]/interactions/route.ts:62-84`

```typescript
const interaction = await prisma.$transaction(async (tx) => {
  const created = await tx.crmInteraction.create({ ... });
  await syncCrmLifecycleAfterInteraction(id, { ... }, tx);  // 在内层
  return created;
});
```

`syncCrmLifecycleAfterInteraction` 内部做了 upsert task + update profile + `syncCrmLifecycleForCustomer`。任一步失败（如 `sourceOpenKey` 唯一约束冲突）会导致**整条已发生的互动记录被回滚**。

**修复**：将 `syncCrmLifecycleAfterInteraction` 移到 transaction 外部，用 try/catch 包裹。

### 8. [HIGH] `syncCrmLifecycleForCustomer` 未被 try-catch 包裹（5 处）

**文件**:
- `src/app/api/orders/route.ts:402-404`
- `src/app/api/orders/[id]/route.ts:266-268`
- `src/app/api/orders/import/commit/route.ts:344`
- `src/app/api/orders/import/pingoodmice/route.ts:173`
- `src/lib/orders/import-batch.ts:277`

订单已写入成功后 lifecycle sync 是 best-effort 副作用。若抛异常会导致 API 返回 500，但订单数据已持久化——造成不一致和误导用户的错误信息。

**修复**：包裹 try/catch，catch 中 `console.error` 即可。

### 9. [MEDIUM] `follow-ups/[id]` PATCH 也在事务内调 lifecycle 同步

**文件**: `src/app/api/crm/follow-ups/[id]/route.ts:98`

与 Bug #7 同一模式。task 状态变更与 `syncCrmLifecycleAfterInteraction` 在同一事务内。

### 10. [MEDIUM] `syncCrmLifecycleForCustomer` 无条件写 DB

**文件**: `src/lib/crm/lifecycle.ts:337-346`

`changed` 变量被计算但从未用于跳过 update。每次调用都执行一次 DB write，即使 stage 和 lastOrderAt 都没变。批量导入订单时每个订单触发一次 sync，形成写放大。

### 11. [MEDIUM] `lastOrderAt` 字段双源冗余

`CrmCustomerProfile.lastOrderAt` 既作为 DB 缓存（由 `syncCrmLifecycleForCustomer` 写入），又在 lifecycle summary 中从 Order 表实时聚合。`profiles/route.ts:126` 优先取聚合值回退 DB 字段。如果某流程直接操作 Order 表而未触发 lifecycle sync，DB 缓存就过时。

---

## 三、API 设计问题

### 12. [MEDIUM] 两个 lifecycle scan 入口

- `POST /api/crm/lifecycle/scan` — session auth，ADMIN only，手动触发
- `POST /api/internal/crm-lifecycle/run` — token auth（cron 触发）

两者调用同一函数。区别仅在认证方式，可接受。但 cron endpoint (`src/app/api/internal/crm-lifecycle/run/route.ts`) 当前是 untracked 状态，与部署脚本改动一起提交即可。

### 13. [LOW] `buildCrmWhereForRole` 标记 `@deprecated` 但仍在使用

**文件**: `src/lib/crm/permissions.ts:125-128`

`follow-ups/route.ts:15` 和 `follow-ups/route.ts:71` 仍使用已废弃函数。应迁移到 `getCrmProfileScopeWhere`。

### 14. [LOW] Profile 详情端点近似重复

- `GET /api/crm/profiles/[id]` — 按 profile ID
- `GET /api/crm/profiles/by-customer/[sourceCustomerId]` — 按 customer ID

返回结构几乎相同。可合并为一个端点加查询参数区分。

### 15. [LOW] Profile 排序不支持 lifecycle 计算字段

`profiles/route.ts` 的 `validSorts` 仅含 `["updatedAt", "createdAt", "lastFollowUpAt", "nextFollowUpAt", "stage"]`。前端暴露了 `hasOrder`、`dormantRisk` 等筛选，用户会期望按 `lastOrderAt`、`validOrderCount` 排序。

---

## 四、度量 / 逻辑问题

### 16. [MEDIUM] 沟通完成率计算公式有误

**文件**: `src/lib/crm/communication-metrics.ts:96-98`

```
communicationTaskCompletionRate = doneCommunicationTaskCount / dueCommunicationTaskCount
```

`doneCommunicationTaskCount` = 期间内**完成**的任务（按 `completedAt`），`dueCommunicationTaskCount` = 期间内**到期**的任务（按 `dueAt`）。它们是两个不同的任务集合，比值不表示"到期任务的完成率"。

### 17. [LOW] 多处重复 30 天日期计算

`admin-analytics/route.ts`、`representatives/route.ts`、`representatives/[representativeId]/route.ts`、`dashboard/route.ts` 各自内联 `new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)`。`lifecycle.ts` 已有 `subtractDays()` 辅助函数，应复用。

---

## 总结优先级

| 优先级 | 编号 | 问题 | 影响 |
|--------|------|------|------|
| P0 | #1 | Profile 列表内存分页 | 随数据量增长直接不可用 |
| P0 | #2 | `scanDormantCrmProfiles` N+1 | cron 定时扫描，每次全量 |
| P0 | #3 | `customer-pool/scan` N+1 | 定时扫描，同上 |
| P1 | #7 | 互动记录事务粒度 | 可能丢失互动数据 |
| P1 | #8 | lifecycle sync 未 try-catch | 订单 API 可能返回虚假 500 |
| P2 | #4 | admin-analytics 每个代表各查一次 | ADMIN 页面随代表数变慢 |
| P2 | #6 | 订单聚合无日期边界 | 老客户历史订单全量加载 |
| P2 | #11 | `syncCrmLifecycleForCustomer` 无条件写 DB | 写放大 |
| P3 | #9 #12 #13 #14 #15 #16 #17 | API 设计 / 度量逻辑小问题 | 代码质量与维护性 |
