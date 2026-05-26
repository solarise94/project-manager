# CRM 代码审查修复计划 (2026-05-26)

基于对当前工作区未提交变更的代码审查，涉及以下文件：

- `src/lib/crm/lifecycle.ts` — Prisma SQLite 类型归一化
- `src/app/crm/representatives/page.tsx` — 错误处理与 fetch 封装
- `scripts/repair-crm-visit-checkin-datetimes.ts` — 新增运维脚本
- `docs/` — 文档变更

---

## 修复项清单

### F-1 合并重复的 normalize 辅助函数

**优先级**：P2
**文件**：`src/lib/crm/lifecycle.ts:25-33`

**现状**：`normalizeCount` 和 `normalizeAmount` 函数签名与实现完全一致，均为 `bigint | number | null | undefined → number`。

```typescript
// 当前：两个完全相同的函数
function normalizeCount(value: bigint | number | null | undefined): number { ... }
function normalizeAmount(value: bigint | number | null | undefined): number { ... }
```

**修复方案**：合并为单一 `normalizeNumber` 函数。

```typescript
function normalizeNumber(value: bigint | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}
```

调用处统一替换：

```typescript
// before
validOrderCount: normalizeCount(row.validOrderCount),
validOrderAmount: normalizeAmount(row.validOrderAmount),

// after
validOrderCount: normalizeNumber(row.validOrderCount),
validOrderAmount: normalizeNumber(row.validOrderAmount),
```

**验证**：`npm run lint` 无新增告警；代表面板加载正常。

---

### F-2 收窄 `OrderAggregateRow` 类型定义

**优先级**：P3
**文件**：`src/lib/crm/lifecycle.ts:18-23`

**现状**：`OrderAggregateRow` 类型为防御性宽类型，`lastOrderAt` 包含 `Date | string | number | bigint | null` 五种可能。这掩盖了 Prisma 返回类型的根本原因。

```typescript
// 当前
type OrderAggregateRow = {
  customerId: string | null;
  validOrderCount: bigint | number;
  validOrderAmount: bigint | number | null;
  lastOrderAt: Date | string | number | bigint | null;  // 太宽
};
```

**修复方案**：

1. 确认 Prisma SQLite `$queryRaw` 对 `COUNT(*)` / `SUM()` / `MAX()` 的实际返回类型（SQLite 下 `COUNT` / `SUM` 通常返回 `bigint`，`MAX(DateTime)` 返回 `string`）。
2. 收窄类型到实际可能的范围，并在注释中说明原因：

```typescript
/**
 * Prisma SQLite $queryRaw 返回类型：
 * - COUNT(*) / SUM() → bigint（SQLite 整数）
 * - MAX(DateTime 列) → string（ISO 8601 或遗留格式）
 */
type OrderAggregateRow = {
  customerId: string | null;
  validOrderCount: bigint;
  validOrderAmount: bigint | null;
  lastOrderAt: string | null;
};
```

3. 如果收窄后运行时报类型不匹配，说明存在 Prisma 版本行为差异，需在文档中记录。

**验证**：运行 `npx tsx scripts/repair-crm-visit-checkin-datetimes.ts --db prisma/dev.db` 确认当前数据库能正常读取聚合结果。

---

### F-3 将 `fetchJsonOrThrow` 提取为共享工具函数

**优先级**：P2
**文件**：`src/app/crm/representatives/page.tsx:26-36`

**现状**：`fetchJsonOrThrow` 定义在页面组件文件中，无法被其他 CRM 页面复用。其他页面（profiles、follow-ups、dashboard 等）大概率仍使用 `.then(r => r.json())` 模式，存在相同的静默失败问题。

**修复方案**：

1. 新建 `src/lib/fetch-client.ts`：

```typescript
export async function fetchJsonOrThrow<T>(input: string | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
```

2. 更新 `src/app/crm/representatives/page.tsx` 改为从 `@/lib/fetch-client` 导入。
3. 逐步迁移其他 CRM 页面（可作为后续小 PR）。

**验证**：`npm run lint` 无报错；representatives 页面错误状态展示正常。

---

### F-4 修复脚本添加 `sqlite3` 缺失检测

**优先级**：P1
**文件**：`scripts/repair-crm-visit-checkin-datetimes.ts:135-148`

**现状**：脚本通过 `execFileSync("sqlite3", ...)` 调用系统 CLI。如果目标机器未安装 `sqlite3`，`execFileSync` 会抛出 `ENOENT`，错误信息不友好。

**修复方案**：在 `runSqliteJson` 和 `runSqlite` 中包装 try/catch，给出清晰提示：

```typescript
function runSqliteJson<T>(dbPath: string, sql: string): T {
  try {
    const stdout = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
    });
    return stdout.trim() ? (JSON.parse(stdout) as T) : ([] as unknown as T);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT") {
      console.error("[CHECKIN-DATETIME] sqlite3 CLI not found. Please install sqlite3 first.");
      process.exit(1);
    }
    throw error;
  }
}
```

`runSqlite` 同理。

**验证**：在 `PATH` 中临时移除 sqlite3 后运行脚本，确认输出友好错误信息。

---

### F-5 修复脚本加入 git 跟踪

**优先级**：P0
**文件**：`scripts/repair-crm-visit-checkin-datetimes.ts`

**现状**：文件为 untracked 状态（`??`），不会随 commit 提交。

**修复方案**：

```bash
git add scripts/repair-crm-visit-checkin-datetimes.ts
```

**验证**：`git status` 显示为 staged。

---

### F-6 清理工作区中的临时文件

**优先级**：P1
**文件**：

- `订单列表1779241856.csv` — 看起来是一次性导出的订单数据
- `prisma/dev.db` — 开发数据库变更

**修复方案**：

1. **CSV 文件**：确认是否需要保留。如不需要，删除并考虑加入 `.gitignore`：
   ```
   # 一次性导出文件
   订单列表*.csv
   ```

2. **`prisma/dev.db`**：确认本次变更是否包含有意义的 schema/数据更新。如果只是开发过程中的测试数据变化，建议还原：
   ```bash
   git checkout -- prisma/dev.db
   ```
   如果包含了 seed 数据变更或 schema push 的结果，应随代码一起提交。

**验证**：`git status` 中不再出现无关文件。

---

### F-7 在 Demo / 生产环境执行签到时间修复

**优先级**：P1
**依赖**：F-5 完成后

**修复方案**：按环境依次执行：

```bash
# 1. 开发环境（已在本次变更中完成）
npx tsx scripts/repair-crm-visit-checkin-datetimes.ts --db prisma/dev.db
npx tsx scripts/repair-crm-visit-checkin-datetimes.ts --write --db prisma/dev.db

# 2. Demo 环境
npx tsx scripts/repair-crm-visit-checkin-datetimes.ts --db /home/solarise/task-manager-data/demo/dev.db
npx tsx scripts/repair-crm-visit-checkin-datetimes.ts --write --db /home/solarise/task-manager-data/demo/dev.db

# 3. 本机生产镜像
npx tsx scripts/repair-crm-visit-checkin-datetimes.ts --db /home/solarise/task-manager-data/prod/dev.db
npx tsx scripts/repair-crm-visit-checkin-datetimes.ts --write --db /home/solarise/task-manager-data/prod/dev.db

# 4. 远程正式生产（101.34.158.217）
#    需先 SSH 到远程服务器，或在远程部署脚本中加入此步骤
```

每次执行前确认 dry-run 输出合理，`unsupported_fields=0` 后再加 `--write`。

如果确认历史脏数据是按本地时间（UTC+8）直接写入而非 UTC，使用 `--timezone +08:00`。

**验证**：修复后 `unsupported_fields=0`、`repairable_fields=0`。

---

## 订单绑定审查：下单数 / 下单金额数据链路

### 数据链路概要

```
CrmCustomerProfile.sourceCustomerId
        ↓ (= Customer.id)
Order.customerId  ←── 唯一关联路径
        ↓
getOrderAggregatesForCustomers()
  SQL: WHERE customerId IN (...) AND deleted=F AND archived=F
       AND status IN ('CONFIRMED','CLOSED')
       GROUP BY customerId
        ↓
  COUNT(*) → validOrderCount
  SUM(COALESCE(financeAmountOverride, totalAmount, 0)) → validOrderAmount
  MAX(COALESCE(orderedAt, confirmedAt, createdAt)) → lastOrderAt
```

### ✅ 确认正确的部分

| 环节 | 状态 | 说明 |
|------|------|------|
| Profile → Customer 关联 | ✅ | `sourceCustomerId` = `Customer.id`，一对一唯一 |
| 状态过滤 `CONFIRMED/CLOSED` | ✅ | 正确排除 `DRAFT` 和 `CANCELLED` |
| 软删除/归档过滤 | ✅ | `deleted=F AND archived=F`，合并源订单不会被重复计数 |
| 金额 fallback 链 | ✅ | `COALESCE(financeAmountOverride, totalAmount, 0)` 优先级合理 |
| 项目绑定时客户继承 | ✅ | `linkOrderToProject()` 双向回填 customerId |
| `financeTreatment = EXCLUDED` 仍计入 | ✅ 设计决策 | CRM 统计看客户参与度，不是财务应收口径 |

---

### 🐛 Bug 清单

### F-8 [BUG] 代表面板「今日/本周订单」查询条件缺失

**优先级**：P1
**文件**：`src/app/api/crm/representatives/route.ts:229-238`

**现状**：`periodOrders` 查询（今日/本周下单数/金额统计）的 where 条件不完整：

```typescript
// 当前 — 缺少 archived 和 status 过滤
prisma.order.findMany({
  where: {
    customerId: { in: allAssignedCustomerIds },
    orderedAt: { gte: periodStart, lt: periodEnd },
    deleted: false,
    // ❌ 缺少 archived: false
    // ❌ 缺少 status: { in: ["CONFIRMED", "CLOSED"] }
  },
  select: { customerId: true, totalAmount: true, financeAmountOverride: true },
})
```

**对比**：lifecycle SQL 和 dashboard 的过滤条件：

```typescript
// dashboard/route.ts:27-31 — 正确
const validOrderWhere = {
  deleted: false,
  archived: false,
  status: { in: ["CONFIRMED", "CLOSED"] },
};
```

**后果**：代表面板的「今日/本周下单数/金额」会把 `DRAFT`、`CANCELLED`、`archived` 的订单也计入，导致数字比 lifecycle 聚合值偏高。

**修复方案**：

```typescript
// after
prisma.order.findMany({
  where: {
    customerId: { in: allAssignedCustomerIds },
    orderedAt: { gte: periodStart, lt: periodEnd },
    deleted: false,
    archived: false,
    status: { in: ["CONFIRMED", "CLOSED"] },
  },
  select: { customerId: true, totalAmount: true, financeAmountOverride: true },
})
```

**验证**：创建一个 `status: "DRAFT"` 的订单，确认代表面板的今日/本周统计不包含该订单。

---

### F-9 [BUG] 拼好鼠导入订单始终无 customerId，CRM 统计不可见

**优先级**：P2
**文件**：`src/app/api/orders/import/pingoodmice/route.ts:113-136`

**现状**：拼好鼠 CSV 导入创建订单时，`customerId` 字段从未设置：

```typescript
const order = await tx.order.create({
  data: {
    orderNo,
    source: normalizedSource,
    // ... 没有 customerId
    buyerNameSnapshot: row.receiverName,
    buyerPhoneSnapshot: row.receiverPhone,
    totalAmount,
  },
});
```

这些订单在 CRM 生命周期聚合中完全不可见——不计入任何客户的「下单数」「下单金额」「最近下单时间」。直到用户在 `/finance/order-matching` 页面手动匹配客户后才会生效。

**影响范围**：所有未经手动匹配的拼好鼠订单在 CRM 面板上不可见。对销售/代表来说，这些订单的销售额「消失」了。

**修复方案**：

此问题属于上游数据流程设计，不适合简单加一行 customerId 修复。建议分两步：

**步骤 1**（本次）：在拼好鼠导入时自动尝试客户匹配。复用现有 `src/lib/finance/pingoodmice-match.ts` 的四层匹配逻辑（微信/电话/姓名+机构/姓名+地址），匹配成功则直接写入 `customerId`：

```typescript
// pingoodmice/route.ts — 在 order.create 之前
import { scanPingoodmiceMatch } from "@/lib/finance/pingoodmice-match";

const matchResult = await scanPingoodmiceMatch({
  buyerPhone: row.receiverPhone,
  buyerWechat: row.orderUser,
  buyerName: row.receiverName,
  buyerAddress: row.receiverAddress,
  buyerOrgName: row.storeName,
});

const matchedCustomerId = matchResult?.customerId ?? null;

const order = await tx.order.create({
  data: {
    // ...existing fields...
    customerId: matchedCustomerId,
    customerMatchStatus: matchedCustomerId ? "AUTO_MATCHED" : "UNMATCHED",
    customerMatchReason: matchedCustomerId
      ? `auto_matched_by_${matchResult.matchMethod}`
      : null,
  },
});
```

**步骤 2**（后续）：在 `/finance/order-matching` 页面增加提示，告知用户有多少未匹配订单及其估计金额。

**验证**：
- 导入一份拼好鼠 CSV，确认已有客户（按电话/微信匹配）的订单自动获得 `customerId`。
- CRM 代表面板中该客户的下单数/金额正确反映新导入的订单。

---

### F-9b [PERF] 拼好鼠导入客户匹配性能优化

**优先级**：P2
**文件**：`src/lib/finance/pingoodmice-match.ts`、`src/app/api/orders/import/pingoodmice/route.ts`
**设计文档**：`docs/pingoodmice-match-batch-optimization-design.md`

**现状**：F-9 实现了导入时自动匹配客户，但存在两个性能问题：

1. `scanPingoodmiceMatch` 每行 CSV 独立加载全量 Customer + Organization 表（N 行 = 2N 次全表查询）
2. 每行都对全部客户做四层匹配遍历 O(N×M)，没有利用索引

同时 `scanPingoodmiceMatch`（~170 行）与 `matchSourceOrders`（~140 行）的匹配逻辑几乎逐行重复。

**修复方案**：三层拆分架构

| 层 | 职责 | DB 调用 |
|----|------|:-------:|
| `createMatchContext()` | 一次性加载 Customer/Organization + 构建 wechat/phone 哈希索引 | 2 次 |
| `resolveMatch(ctx, params)` | 纯函数匹配，Layer 1/2 走 O(1) 哈希查找 | 0 次 |
| `scanPingoodmiceMatch(params)` | 兼容包装（旧调用方），内部走 create + resolve | 2 次 |

路由改造：循环前调用一次 `createMatchContext()`，循环内用 `resolveMatch()` 替换 `scanPingoodmiceMatch()`。

**性能收益**：

| 场景 | 当前 DB 查询 | 优化后 |
|------|:----------:|:------:|
| 导入 50 行 | 100 次 | **2 次** |
| 导入 200 行 | 400 次 | **2 次** |
| 导入 1000 行 | 2000 次 | **2 次** |

额外收益：消除 `matchSourceOrders` 中 ~150 行重复代码，改为复用 `resolveMatch`。

**验证**：用测试 CSV 导入，对比匹配结果与改造前一致；`npm run lint` 无新增告警。

---

### F-10 [DESIGN] OrderProjectLink 路径未被 lifecycle 遍历

**优先级**：P3（当前为设计决策，非 bug）
**文件**：`src/lib/crm/lifecycle.ts:108-120`

**现状**：lifecycle SQL 只按 `Order.customerId` 直接关联。如果一个订单：
- `customerId = null`（无直接客户绑定）
- 但通过 `OrderProjectLink` → `Project.customerId` 间接关联了一个有客户的项目

那这个订单不会被计入该客户的下单统计。

**为什么目前不是 bug**：`linkOrderToProject()` 在绑定项目时会**双向回填 customerId**（`src/lib/orders/link-project.ts:121-131`）：

```typescript
// 订单无客户、项目有客户 → 继承项目客户到订单
if (!oCustId && pCustId) {
  result.orderUpdateData = {
    customerId: pCustId,
    customerMatchStatus: "MANUAL_MATCHED",
    customerMatchReason: "inherited_from_project_link",
  };
}
```

所以正常流程下，绑定项目后订单一定会有 `customerId`。

**风险场景**：如果 Project 本身也没有 `customerId`（例如独立创建的项目），那关联的订单会永久处于"无客户"状态，在 CRM 中不可见。

**修复方案**（可选，后续优化）：

在 lifecycle SQL 中增加 `OrderProjectLink` fallback 路径：

```sql
-- 方案 A：LEFT JOIN OrderProjectLink + Project 补全 customerId
SELECT
  COALESCE(o."customerId", p."customerId") AS "customerId",
  COUNT(*) AS "validOrderCount",
  SUM(COALESCE(o."financeAmountOverride", o."totalAmount", 0)) AS "validOrderAmount",
  MAX(COALESCE(o."orderedAt", o."confirmedAt", o."createdAt")) AS "lastOrderAt"
FROM "Order" o
LEFT JOIN "OrderProjectLink" opl ON opl."orderId" = o."id" AND opl."isPrimary" = 1
LEFT JOIN "Project" p ON p."id" = opl."projectId"
WHERE COALESCE(o."customerId", p."customerId") IN (${Prisma.join(uniqueIds)})
  AND o."deleted" = false
  AND o."archived" = false
  AND o."status" IN ('CONFIRMED', 'CLOSED')
GROUP BY COALESCE(o."customerId", p."customerId")
```

**注意**：方案 A 会引入 JOIN 开销。在数据量大之前（< 10000 订单），保持现状即可。如果后续出现"项目有客户但订单无客户"的实际案例，再落地此方案。

**验证**：如果实施，创建一个 `customerId = null` 的订单，通过 `OrderProjectLink` 绑定到有客户的项目（但不手动回填 customerId），确认 lifecycle 能正确统计。

---

### 数据口径差异速查表

不同页面/模块对「有效订单」的定义不完全一致，汇总如下：

| 统计场景 | `deleted` | `archived` | `status` | 含 DRAFT | 含 EXCLUDED |
|----------|:---------:|:----------:|:--------:|:--------:|:-----------:|
| lifecycle 下单数/金额 | ✅ F | ✅ F | CONFIRMED/CLOSED | ❌ | ✅ |
| Dashboard 下单客户数 | ✅ F | ✅ F | CONFIRMED/CLOSED | ❌ | ✅ |
| 代表面板 lifecycle 指标 | ✅ F | ✅ F | CONFIRMED/CLOSED | ❌ | ✅ |
| **代表面板「今日/本周」** | ✅ F | **❌ 缺失** | **❌ 缺失** | **✅ 误含** | ✅ |
| 财务模块应收款 | — | — | CONFIRMED/CLOSED | ❌ | ❌ 排除 |

F-8 修复后，代表面板「今日/本周」与 lifecycle 口径将完全一致。

---

## 优先级总结

| 优先级 | 编号 | 修复项 | 状态 | 工作量 |
|--------|------|--------|:----:|--------|
| P0 | F-5 | 修复脚本加入 git | ✅ | 1 min |
| P1 | F-4 | sqlite3 缺失检测 | ✅ | 5 min |
| P1 | F-6 | 清理临时文件 | ✅ | 2 min |
| P1 | F-7 | Demo / 生产执行签到时间修复 | ✅ | 10 min |
| P1 | F-8 | 代表面板「今日/本周」查询条件缺失 | ✅ | 5 min |
| P2 | F-1 | 合并 normalize 函数 | ✅ | 5 min |
| P2 | F-3 | 提取 fetchJsonOrThrow | ✅ | 10 min |
| P2 | F-9 | 拼好鼠导入自动客户匹配 | ✅ | 30 min |
| **P2** | **F-9b** | **拼好鼠匹配性能优化（批量 context + 索引）** | ✅ | **45 min** |
| P3 | F-2 | 收窄类型定义 | ✅ | 15 min |
| P3 | F-10 | OrderProjectLink fallback 路径（可选） | — | 20 min |

---

## 不在本次范围

以下为 CRM 系统审阅（`crm-system-review-2026-05-26.md`）中已识别但属于独立修复周期的问题，不在本次 PR 范围：

- `buildCrmWhereForRole` deprecated 但仍在使用（#13）
- Profile 详情端点合并（#14）
- 30 天日期计算重复代码（#17）
- 沟通完成率公式问题（#16，已决策搁置）
