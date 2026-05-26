# CRM 自动化客户运营执行计划

## 状态

本文是 CRM 自动化客户管理的执行文档，目标是把客户生命周期、下单活跃、休眠、复购、代表沟通任务统计落到现有系统中。

实现后必须跑：

```bash
npm run lint
npm run build
```

本文不是长期架构讨论，重点是可直接拆任务实现。默认不引入新的独立 CRM 系统，先复用当前 `CrmCustomerProfile`、`CrmInteraction`、`CrmFollowUpTask`、`Order` 和代表运营页面。

---

## 目标

### 业务目标

1. 客户加入 CRM 后，如果长期没有下单，自动进入休眠客户。
2. 客户被联系后，应刷新跟进状态和休眠倒计时。
3. 客户下单后，应自动进入活跃客户。
4. 同一客户多次有效下单后，应计入复购客户，并能计算复购率。
5. 代表的沟通任务和沟通完成情况应进入代表运营面板，方便管理者检查。
6. 自动化只做可解释的状态推进，不覆盖人工明确标记的异常状态。

### 产品目标

1. CRM 首页展示生命周期分布和关键转化指标。
2. 代表运营页面展示每个代表的客户数、沟通任务数、沟通完成率、下单客户数、复购客户数、复购率、休眠风险。
3. 客户列表支持按生命周期、是否下单、是否复购、是否长期未沟通筛选。
4. 客户详情页展示最近下单、有效订单数、复购状态、最近沟通、下次沟通任务。

---

## 当前依据

### 已有模型

`CrmCustomerProfile` 已有：

1. `stage`: `NEW | CONTACTED | FOLLOWING | ACTIVE | BLOCKED | LOST | DORMANT`
2. `lastFollowUpAt`
3. `nextFollowUpAt`
4. `lastOrderAt`
5. `ownerUserId`
6. `assignmentStatus`
7. `archived`

`CrmInteraction` 已有：

1. `profileId`
2. `type`: `CALL | WECHAT | EMAIL | MEETING | VISIT | REFERRAL | NOTE`
3. `happenedAt`
4. `nextActionAt`
5. `createdByUserId`

`CrmFollowUpTask` 已有：

1. `profileId`
2. `ownerUserId`
3. `dueAt`
4. `status`: `OPEN | DONE | CANCELLED | EXPIRED`
5. `completedAt`
6. `completedInteractionId`

`Order` 已有：

1. `customerId`
2. `status`: `DRAFT | CONFIRMED | CANCELLED | CLOSED`
3. `orderedAt`
4. `confirmedAt`
5. `totalAmount`
6. `financeAmountOverride`
7. `representativeId`
8. `deleted`
9. `archived`

### 现有缺口

1. `lastOrderAt` 没有形成统一同步链路。
2. 新增沟通记录时只更新 `lastFollowUpAt`，没有自动推进 `stage`。
3. 订单创建、导入、绑定客户、状态变更后，没有统一反写 CRM 生命周期。
4. 复购率没有统一口径和 API。
5. 代表运营页面已有拜访、互动、逾期跟进统计，但缺少“沟通任务”的完成检查口径。
6. 现有 `/api/crm/customer-pool/scan` 是“超过 N 天未拜访进入待收回”，不等同于客户生命周期休眠。

---

## 核心口径

### 有效订单

有效订单用于判断客户是否活跃、是否复购。

```ts
const validOrderWhere = {
  deleted: false,
  archived: false,
  customerId: { not: null },
  status: { in: ["CONFIRMED", "CLOSED"] },
};
```

有效订单日期：

```ts
order.orderedAt ?? order.confirmedAt ?? order.createdAt
```

说明：

1. `DRAFT` 不计入有效订单。
2. `CANCELLED` 不计入有效订单。
3. 被删除或归档订单不计入有效订单。
4. 金额为 0 的有效订单是否计入复购，第一版建议计入订单次数，但金额指标单独按金额统计。

### 活跃客户

客户存在至少一笔有效订单时，自动视为活跃客户：

```text
validOrderCount >= 1 -> stage = ACTIVE
```

同时更新：

```text
CrmCustomerProfile.lastOrderAt = latestValidOrderDate
```

### 复购客户

同一 `customerId` 有至少两笔有效订单：

```text
validOrderCount >= 2 -> isRepeatCustomer = true
```

复购率：

```text
repeatCustomerRate = repeatCustomerCount / orderedCustomerCount
```

其中：

1. `orderedCustomerCount`: 有至少一笔有效订单的 CRM 客户数。
2. `repeatCustomerCount`: 有至少两笔有效订单的 CRM 客户数。
3. 统计范围可按全局、代表、地区经理下辖代表、时间窗口过滤。

时间窗口口径：

1. “窗口内复购率”：窗口内有效订单数 `>= 2` 的客户 / 窗口内有效下单客户。
2. “存量复购率”：截至窗口结束累计有效订单数 `>= 2` 的客户 / 截至窗口结束累计有效下单客户。
3. 第一版代表运营面板默认使用“窗口内复购率”，客户详情展示累计复购状态。

### 休眠客户

客户没有有效订单，并且超过休眠阈值未发生有效沟通，自动进入休眠：

```text
validOrderCount = 0
AND max(lastFollowUpAt, assignedAt, createdAt) < now - dormantDays
AND stage IN ("NEW", "CONTACTED", "FOLLOWING")
-> stage = DORMANT
```

默认阈值：

```text
dormantDays = 90
```

可配置为 60 或 90 天。建议常量命名：

```ts
CRM_DORMANT_THRESHOLD_DAYS = 90
CRM_DORMANT_WARNING_DAYS = 60
```

不要自动覆盖：

1. `ACTIVE`: 由订单驱动，不因无沟通直接休眠。
2. `BLOCKED`: 人工标记为受阻。
3. `LOST`: 人工标记为流失。
4. `archived = true`: 归档客户。
5. `assignmentStatus != ASSIGNED`: 未正常分配客户。

### 已联系刷新状态

新增沟通记录后，按以下规则刷新：

```text
stage = NEW -> CONTACTED
stage = DORMANT -> CONTACTED
stage = CONTACTED 且 nextActionAt 存在 -> FOLLOWING
stage = FOLLOWING -> FOLLOWING
stage = ACTIVE -> ACTIVE
stage = BLOCKED/LOST -> 不自动覆盖
```

同时更新：

```text
lastFollowUpAt = interaction.happenedAt
nextFollowUpAt = nextActionAt 或最早 OPEN follow-up task dueAt
```

说明：

1. 沟通刷新只代表客户被重新触达，不代表活跃。
2. 活跃只能由有效订单驱动。
3. 休眠客户被联系后先回到已联系或跟进中，后续下单才进入活跃。

### 沟通任务

沟通任务使用现有 `CrmFollowUpTask`，第一版不新增任务表。

建议新增 `sourceType` 枚举约定：

```text
CRM_COMMUNICATION
CRM_DORMANT_WARNING
CRM_REACTIVATION
```

沟通任务统计口径：

1. 应沟通任务数：`CrmFollowUpTask.status in ("OPEN", "DONE", "EXPIRED")` 且 `sourceType` 属于 CRM 沟通类，`dueAt` 在统计窗口内。
2. 已完成沟通任务数：`status = DONE` 且 `completedAt` 在统计窗口内。
3. 逾期沟通任务数：`status = OPEN` 且 `dueAt < now`。
4. 沟通任务完成率：`doneCommunicationTaskCount / dueCommunicationTaskCount`。
5. 有效沟通客户数：窗口内有 `CrmInteraction` 且 `type != NOTE` 的去重客户数。
6. 沟通覆盖率：`communicatedCustomerCount / assignedCustomerCount`。

`NOTE` 是否算沟通：

1. 第一版默认不算有效沟通。
2. `CALL | WECHAT | EMAIL | MEETING | VISIT | REFERRAL` 算有效沟通。

---

## 自动化规则

### 规则 1：订单驱动活跃

触发时机：

1. 手动创建订单。
2. 拼好鼠或其他来源导入订单。
3. 订单绑定或改绑 `customerId`。
4. 订单状态变更到 `CONFIRMED` 或 `CLOSED`。
5. 订单从有效状态变为 `CANCELLED`。
6. 订单删除或归档。

动作：

1. 重新计算该 `customerId` 的有效订单数。
2. 更新 `lastOrderAt`。
3. 有有效订单时设置 `stage = ACTIVE`。
4. 无有效订单时，不立即从 `ACTIVE` 降级，交给定时扫描判断是否休眠或保留人工状态。

### 规则 2：沟通驱动触达

触发时机：

1. 新增 `CrmInteraction`。
2. 完成沟通任务并绑定 `completedInteractionId`。

动作：

1. 更新 `lastFollowUpAt`。
2. 根据已联系刷新状态规则更新 `stage`。
3. 如果 `nextActionAt` 存在，创建或更新一条沟通任务。
4. 重新计算 `nextFollowUpAt`。

### 规则 3：定时休眠扫描

触发时机：

1. 每日定时任务。
2. ADMIN 手动触发扫描接口。

动作：

1. 扫描 `archived = false`、`assignmentStatus = ASSIGNED` 的 CRM 客户。
2. 排除 `ACTIVE | BLOCKED | LOST`。
3. 排除存在有效订单的客户。
4. 计算 `max(lastFollowUpAt, assignedAt, createdAt)`。
5. 超过 `CRM_DORMANT_THRESHOLD_DAYS` 设置为 `DORMANT`。
6. 超过 `CRM_DORMANT_WARNING_DAYS` 但未达休眠阈值，生成或更新一条 `CRM_DORMANT_WARNING` 沟通任务。

### 规则 4：复购统计

触发时机：

1. Dashboard API 查询时实时聚合。
2. 代表运营面板查询时实时聚合。
3. 后续如性能不足，再引入快照表。

第一版不新增 `isRepeatCustomer` 字段，避免缓存和事实源不一致。

---

## 后端实现

### 新增模块

新增：

```text
src/lib/crm/lifecycle.ts
src/lib/crm/communication-metrics.ts
```

`lifecycle.ts` 建议导出：

```ts
export type CrmLifecycleSyncResult = {
  profileId: string;
  customerId: string;
  previousStage: string;
  nextStage: string;
  validOrderCount: number;
  lastOrderAt: Date | null;
  changed: boolean;
};

export async function syncCrmLifecycleForCustomer(customerId: string): Promise<CrmLifecycleSyncResult | null>;

export async function syncCrmLifecycleAfterInteraction(profileId: string, params: {
  happenedAt: Date;
  nextActionAt?: Date | null;
}): Promise<void>;

export async function scanDormantCrmProfiles(params?: {
  dormantDays?: number;
  warningDays?: number;
  dryRun?: boolean;
}): Promise<{
  scannedCount: number;
  warnedCount: number;
  dormantCount: number;
}>;
```

`communication-metrics.ts` 建议导出：

```ts
export type CrmCommunicationMetrics = {
  assignedCustomerCount: number;
  dueCommunicationTaskCount: number;
  doneCommunicationTaskCount: number;
  overdueCommunicationTaskCount: number;
  communicatedCustomerCount: number;
  communicationTaskCompletionRate: number;
  communicationCoverageRate: number;
};

export async function getCrmCommunicationMetrics(params: {
  ownerUserIds?: string[];
  from: Date;
  to: Date;
}): Promise<CrmCommunicationMetrics>;
```

### 新增或调整常量

在 `src/lib/crm/constants.ts` 增加：

```ts
export const CRM_DORMANT_THRESHOLD_DAYS = 90;
export const CRM_DORMANT_WARNING_DAYS = 60;

export const CRM_COMMUNICATION_TASK_SOURCE_TYPES = [
  "CRM_COMMUNICATION",
  "CRM_DORMANT_WARNING",
  "CRM_REACTIVATION",
] as const;

export const CRM_EFFECTIVE_INTERACTION_TYPES = [
  "CALL",
  "WECHAT",
  "EMAIL",
  "MEETING",
  "VISIT",
  "REFERRAL",
] as const;
```

### 新增扫描 API

新增：

```text
src/app/api/crm/lifecycle/scan/route.ts
```

`POST`：

1. 仅 `ADMIN` 可调用。
2. body 支持 `dormantDays`、`warningDays`、`dryRun`。
3. 调用 `scanDormantCrmProfiles()`。
4. 返回扫描数量、预警数量、休眠数量。

示例响应：

```json
{
  "scannedCount": 180,
  "warnedCount": 24,
  "dormantCount": 9
}
```

### 调整沟通记录 API

修改：

```text
src/app/api/crm/profiles/[id]/interactions/route.ts
```

新增 `CrmInteraction` 后，不再只更新 `lastFollowUpAt`，改为调用：

```ts
await syncCrmLifecycleAfterInteraction(id, {
  happenedAt: interaction.happenedAt,
  nextActionAt: interaction.nextActionAt,
});
```

如果 `nextActionAt` 存在，自动创建沟通任务：

```text
sourceType = CRM_COMMUNICATION
sourceId = interaction.id
sourceOpenKey = crm-communication:<interaction.id>
```

注意：

1. 使用事务包住 interaction 创建、profile 更新、follow-up task 创建。
2. `sourceOpenKey` 防重复。
3. 如果用户手动建了任务，不强制合并，第一版只保证自动任务可追踪。

### 调整跟进任务完成 API

修改：

```text
src/app/api/crm/follow-ups/[id]/route.ts
```

当 `status = DONE` 时：

1. 如果有 `completedInteractionId`，使用该 interaction 刷新生命周期。
2. 如果没有 `completedInteractionId`，只完成任务，不视作有效沟通。

原因：

1. 完成任务不一定真的沟通。
2. 管理面板应鼓励代表记录沟通内容，而不是只点完成。

### 调整订单 API 和导入链路

需要在以下写路径调用 `syncCrmLifecycleForCustomer(customerId)`：

1. `src/app/api/orders/route.ts` 创建订单成功后。
2. `src/app/api/orders/[id]/route.ts` 更新订单状态、客户、归档、删除后。
3. `src/app/api/orders/import/pingoodmice/route.ts` 每行成功导入并匹配客户后。
4. `src/app/api/orders/import/commit/route.ts` 每行成功导入并匹配客户后。
5. `src/lib/orders/import-batch.ts` 批量导入成功后。
6. 任何手动绑定订单客户的 API。

如果同一批次有多个订单属于同一客户，先收集 `customerId` 去重，事务完成后逐个同步，避免在 per-row transaction 中重复聚合。

### 扩展 dashboard API

修改：

```text
src/app/api/crm/dashboard/route.ts
```

新增返回：

```ts
{
  orderedCustomerCount: number;
  repeatCustomerCount: number;
  repeatCustomerRate: number;
  dormantCustomerCount: number;
  dormantWarningCustomerCount: number;
  communicatedCustomerCount30d: number;
  communicationCoverageRate30d: number;
}
```

权限：

1. ADMIN 看全部。
2. USER 看自己负责的 CRM 客户。
3. REPRESENTATIVE 看自己负责的 CRM 客户。
4. REGIONAL_MANAGER 看下辖代表负责的 CRM 客户。

### 扩展代表运营 API

优先修改已有：

```text
src/app/api/crm/admin-analytics/route.ts
```

新增每个代表指标：

```ts
{
  dueCommunicationTaskCount: number;
  doneCommunicationTaskCount: number;
  overdueCommunicationTaskCount: number;
  communicationTaskCompletionRate: number;
  communicatedCustomerCount30d: number;
  communicationCoverageRate30d: number;
  orderedCustomerCount30d: number;
  repeatCustomerCount30d: number;
  repeatCustomerRate30d: number;
  dormantCustomerCount: number;
  dormantWarningCustomerCount: number;
}
```

如果需要代表自己查看，复用已有代表 report API：

```text
src/app/api/crm/representatives/[representativeId]/route.ts
src/app/api/crm/representatives/[representativeId]/report/route.ts
```

不要为代表自查和 ADMIN 面板写两套不同口径。

---

## 前端实现

### CRM 首页

修改：

```text
src/app/crm/page.tsx
```

新增指标卡：

1. 活跃客户
2. 休眠客户
3. 休眠预警
4. 30 天有效沟通客户
5. 30 天沟通覆盖率
6. 下单客户
7. 复购客户
8. 复购率

阶段分布继续使用 `stageDistribution`，但增加说明：

```text
活跃 = 有有效订单
休眠 = 长期无订单且无有效沟通
```

### 客户列表

修改：

```text
src/app/crm/customers/page.tsx
src/app/crm/customer-pool/page.tsx
src/app/api/crm/profiles/route.ts
```

新增筛选参数：

```text
hasOrder=true|false
repeatCustomer=true|false
dormantRisk=true|false
communicationDue=true|false
```

第一版 API 可用二段查询实现：

1. 先按 CRM scope 找 profile。
2. 再基于 `sourceCustomerId` 聚合订单或任务。
3. 数据量大后再优化为 SQL raw 或快照表。

列表展示新增：

1. 最近下单时间。
2. 有效订单数。
3. 复购标记。
4. 最近沟通时间。
5. 下次沟通任务。

### 客户详情页

修改：

```text
src/app/crm/customers/[sourceCustomerId]/page.tsx
src/app/api/crm/profiles/[id]/route.ts
```

新增客户运营摘要：

```ts
{
  validOrderCount: number;
  totalOrderAmount: number;
  lastOrderAt: string | null;
  isRepeatCustomer: boolean;
  lastEffectiveInteractionAt: string | null;
  nextCommunicationTaskAt: string | null;
  dormantRisk: boolean;
}
```

详情页展示：

1. 生命周期状态。
2. 最近有效订单。
3. 复购状态。
4. 最近有效沟通。
5. 下次沟通任务。
6. 如果休眠预警，显示“建议联系”提示。

### 代表运营面板

修改：

```text
src/app/crm/representatives/page.tsx
src/components/crm/representative-report-panel.tsx
```

代表列表新增列：

1. 负责客户数。
2. 30 天有效沟通客户数。
3. 30 天沟通覆盖率。
4. 应沟通任务数。
5. 已完成沟通任务数。
6. 逾期沟通任务数。
7. 沟通任务完成率。
8. 30 天下单客户数。
9. 30 天复购客户数。
10. 30 天复购率。
11. 休眠客户数。
12. 休眠预警客户数。

建议视觉优先级：

1. 逾期沟通任务高亮红色。
2. 休眠预警高亮橙色。
3. 复购率和沟通覆盖率用进度条或百分比 badge。
4. 代表行可点击进入详情，详情展示客户明细。

代表详情新增 Tab 或区块：

```text
沟通检查
```

内容：

1. 今日/本周应沟通任务。
2. 逾期沟通任务。
3. 已完成但未绑定沟通记录的任务。
4. 60 天未有效沟通客户。
5. 90 天休眠客户。

---

## 数据模型是否需要新增字段

### 第一版不新增字段

第一版可以完全复用现有字段：

1. `CrmCustomerProfile.stage`
2. `CrmCustomerProfile.lastFollowUpAt`
3. `CrmCustomerProfile.nextFollowUpAt`
4. `CrmCustomerProfile.lastOrderAt`
5. `CrmFollowUpTask.sourceType`
6. `CrmFollowUpTask.sourceOpenKey`

### 第二版可选新增审计表

如果需要追踪自动状态变化原因，再新增：

```prisma
model CrmLifecycleEvent {
  id              String   @id @default(cuid())
  profileId       String
  sourceCustomerId String
  previousStage   String?
  nextStage       String
  reason          String
  sourceType      String
  sourceId        String?
  actorUserId     String?
  metadataJson    String?
  createdAt       DateTime @default(now())

  @@index([profileId, createdAt])
  @@index([sourceCustomerId, createdAt])
  @@index([reason])
}
```

原因：

1. 自动化上线初期规则可能调整。
2. 先不加审计表可以减少迁移和 UI 成本。
3. 如果管理者需要追责或复盘，再补事件表更合适。

### 第二版可选新增快照表

如果订单和 CRM 客户数量明显变大，实时聚合慢，再新增：

```prisma
model CrmCustomerLifecycleSnapshot {
  id                         String   @id @default(cuid())
  profileId                  String   @unique
  sourceCustomerId            String   @unique
  validOrderCount             Int      @default(0)
  validOrderAmount            Float    @default(0)
  lastOrderAt                 DateTime?
  isRepeatCustomer            Boolean  @default(false)
  lastEffectiveInteractionAt  DateTime?
  openCommunicationTaskCount  Int      @default(0)
  overdueCommunicationTaskCount Int    @default(0)
  dormantRisk                 Boolean  @default(false)
  syncedAt                    DateTime @default(now())

  @@index([lastOrderAt])
  @@index([isRepeatCustomer])
  @@index([dormantRisk])
}
```

第一版不要加，除非实际查询性能不够。

---

## 实施拆分

### Phase 1：生命周期后端

1. 新增 CRM 生命周期常量。
2. 新增 `src/lib/crm/lifecycle.ts`。
3. 新增 `/api/crm/lifecycle/scan`。
4. 修改互动创建 API，沟通后刷新 `stage/lastFollowUpAt/nextFollowUpAt`。
5. 修改订单写路径，订单变化后同步 `lastOrderAt/stage`。
6. 手动跑扫描接口验证 NEW/CONTACTED/FOLLOWING 到 DORMANT。

验收：

1. 新客户 90 天无订单无沟通后变 `DORMANT`。
2. 休眠客户新增微信/电话沟通后变 `CONTACTED`。
3. 休眠客户新增带 `nextActionAt` 沟通后变 `FOLLOWING`。
4. 客户有效下单后变 `ACTIVE`。
5. `BLOCKED/LOST` 不被休眠扫描覆盖。

### Phase 2：复购和 dashboard 指标

1. 新增订单聚合 helper。
2. 扩展 `/api/crm/dashboard`。
3. CRM 首页新增活跃、休眠、下单、复购、沟通覆盖指标。
4. 客户详情 API 返回订单摘要。
5. 客户详情页展示复购和最近下单。

验收：

1. 有 1 笔有效订单客户计入下单客户。
2. 有 2 笔有效订单客户计入复购客户。
3. `CANCELLED/DRAFT` 不计入复购。
4. dashboard 受当前用户 CRM scope 限制。

### Phase 3：沟通任务统计

1. 新增 `src/lib/crm/communication-metrics.ts`。
2. 扩展 `/api/crm/admin-analytics`。
3. 沟通记录带 `nextActionAt` 时自动创建 `CRM_COMMUNICATION` 任务。
4. 完成任务时要求绑定 interaction 才计入有效沟通。
5. 代表运营页新增沟通任务列和检查区块。

验收：

1. 代表本周应沟通任务数正确。
2. 代表本周完成沟通任务数正确。
3. 未绑定沟通记录的 DONE 任务不计入有效沟通客户数。
4. 逾期沟通任务在运营面板高亮。
5. 地区经理只能看到下辖代表。

### Phase 4：客户列表筛选和预警

1. `/api/crm/profiles` 支持 `hasOrder/repeatCustomer/dormantRisk/communicationDue`。
2. 客户列表和客户池增加筛选器。
3. 扫描任务生成 `CRM_DORMANT_WARNING` 沟通任务。
4. 客户详情展示休眠预警。

验收：

1. `repeatCustomer=true` 只返回复购客户。
2. `hasOrder=false` 可找出长期未成交客户。
3. `dormantRisk=true` 可找出 60 天未有效沟通且未下单客户。
4. 预警任务不会重复生成。

---

## 权限要求

所有新 API 必须继续使用：

```ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
```

权限边界：

1. ADMIN 可看全部和触发扫描。
2. USER 只能看自己拥有的 CRM 客户及相关指标。
3. REPRESENTATIVE 只能看自己负责的 CRM 客户及相关指标。
4. REGIONAL_MANAGER 只能看下辖代表相关指标。

禁止：

1. 前端传 `ownerUserId` 后端直接信任。
2. 指标聚合绕过 CRM scope。
3. 订单聚合直接全表统计后再前端过滤。

---

## 性能注意事项

第一版数据量可接受时使用 Prisma 聚合即可，但必须避免 N+1。

推荐方式：

1. 先取当前 scope 下的 `sourceCustomerId[]`。
2. 用 `Order.groupBy({ by: ["customerId"] })` 批量聚合订单。
3. 用 `CrmInteraction.groupBy({ by: ["profileId"] })` 批量聚合沟通。
4. 用 `CrmFollowUpTask.groupBy({ by: ["ownerUserId"] })` 批量聚合任务。

避免：

1. 对每个 profile 单独查询订单。
2. 对每个代表单独查询所有任务。
3. 在列表分页接口中对全量 profile 做复杂内存过滤。

如果 `groupBy` 无法表达窗口内复购，允许使用 `$queryRaw`，但必须保持 scope 条件。

---

## 定时任务建议

本项目当前没有统一生产 cron 框架。第一版提供 ADMIN 扫描 API 和脚本入口即可。

建议新增脚本：

```text
scripts/run-crm-lifecycle-scan.ts
```

用途：

1. 本地或服务器 cron 调用。
2. 调用 `scanDormantCrmProfiles()`。
3. 输出扫描结果。

Demo/生产部署后可由外部 cron 每天凌晨执行。

---

## 测试与验证

当前项目没有测试框架，第一版用手动验证和构建验证。

必须验证：

1. `npm run lint`
2. `npm run build`
3. 本地开发库构造 5 类客户：
   - 新增 90 天无沟通无订单客户。
   - 已联系但 90 天无订单客户。
   - 休眠后重新沟通客户。
   - 一次有效下单客户。
   - 两次有效下单客户。
4. ADMIN 触发生命周期扫描。
5. CRM 首页指标正确。
6. 代表运营面板沟通任务统计正确。
7. 代表和地区经理权限过滤正确。

---

## 风险与边界

### 风险 1：自动状态覆盖人工判断

控制方式：

1. 不自动覆盖 `BLOCKED/LOST`。
2. `ACTIVE` 只由有效订单驱动。
3. 休眠扫描只处理 `NEW/CONTACTED/FOLLOWING`。

### 风险 2：订单客户匹配错误导致误激活

控制方式：

1. 只使用 `Order.customerId` 已绑定订单。
2. `UNMATCHED` 订单不参与。
3. 订单绑定客户后再触发生命周期同步。

### 风险 3：代表只点完成任务但不记录沟通

控制方式：

1. 任务完成不等同有效沟通。
2. 有效沟通以 `CrmInteraction` 为准。
3. 运营面板单独展示“已完成但未绑定沟通记录”的任务。

### 风险 4：复购率口径混乱

控制方式：

1. API 字段名明确区分 `repeatCustomerRate30d` 和累计 `isRepeatCustomer`。
2. 页面文案明确“30 天复购率”或“累计复购”。

---

## 不做项

第一版不做：

1. 不新增独立生命周期状态表。
2. 不新增销售漏斗机会模型。
3. 不把 `Customer` 主数据 owner 迁移到 CRM。
4. 不把 `stage` 拆成多个 enum 字段。
5. 不做预测模型或 AI 自动评分。
6. 不把普通备注 `NOTE` 计入有效沟通。

---

## 推荐实现顺序

1. `lifecycle.ts` 和扫描 API。
2. 互动创建后刷新状态。
3. 订单写路径同步状态。
4. dashboard 下单/复购/休眠指标。
5. `communication-metrics.ts`。
6. 代表运营面板沟通任务统计。
7. 客户列表筛选和客户详情运营摘要。

