# 拼好鼠导入客户匹配性能优化设计 (F-9b)

## 问题陈述

F-9 实现了拼好鼠导入时自动客户匹配，但引入了两个性能问题：

1. **N+1 全表查询**：`scanPingoodmiceMatch` 每行 CSV 都独立加载全量 Customer + Organization 表
2. **O(N×M) 线性扫描**：每行都对全部客户做四层匹配遍历，没有利用索引预构建

同时，`scanPingoodmiceMatch` 与已有的 `matchSourceOrders` 有约 150 行完全重复的匹配逻辑。

---

## 现状分析

### 调用链路

```
POST /api/orders/import/pingoodmice
  │
  for (let i = 0; i < rows.length; i++)        ← N 行 CSV
  │
  ├── scanPingoodmiceMatch(row)                 ← 每行调用一次
  │     ├── customer.findMany(deleted=false)    ← ❌ 全表扫描 × N
  │     ├── organization.findMany()             ← ❌ 全表扫描 × N
  │     └── for (cust of allCustomers) { ... }  ← ❌ O(M) 线性遍历 × N
  │
  └── prisma.$transaction(create order ...)
```

### 性能估算

| CSV 行数 | 客户数 | Customer 查询次数 | Organization 查询次数 | 内存遍历次数 |
|:--------:|:------:|:-----------------:|:---------------------:|:----------:|
| 50 | 200 | 50 | 50 | 10,000 |
| 200 | 500 | 200 | 200 | 100,000 |
| 1000 | 500 | 1000 | 1000 | 500,000 |

### 代码重复

`scanPingoodmiceMatch`（L295-468）与 `matchSourceOrders`（L63-206）中的匹配逻辑几乎逐行一致：

| 函数 | 行数 | 职责 |
|------|:----:|------|
| `matchOrgAgainstOrderAddress()` | ~30 行 | 从收货地址提取机构名 |
| `matchOrgName()` | ~25 行 | 机构名比对（精确/模糊） |
| 四层评分循环 | ~60 行 | 微信 → 电话 → 姓名+机构 → 姓名+地址 |
| 候选排序 + 置信度判定 | ~10 行 | 分差 ≥ 10 才接受 |

---

## 设计方案

### 架构变更

将匹配逻辑拆为三层：

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: MatchContext (预加载 + 索引)                    │
│  ─ 一次性加载 Customer / Organization                     │
│  ─ 构建 wechatIndex / phoneIndex 哈希表                   │
└────────────────────┬─────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────┐
│  Layer 2: resolveMatch() (纯函数)                        │
│  ─ 接受 MatchContext + 订单快照字段                       │
│  ─ 返回候选列表 + 最佳匹配                                │
│  ─ 无 DB 调用，可单元测试                                 │
└────────────────────┬─────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼────────┐      ┌────────▼─────────────┐
│ scanPingood    │      │ matchSourceOrders     │
│ miceMatch      │      │ (手动扫描匹配)         │
│ (导入时单行)    │      │                       │
│ + batch 入口   │      │ 调用 resolveMatch     │
└────────────────┘      └───────────────────────┘
```

### 类型定义

```typescript
// src/lib/finance/pingoodmice-match.ts

/** Customer select 投影类型（由 Prisma infer） */
type MatchCustomer = Awaited<ReturnType<typeof loadMatchCustomers>>[number];
type MatchOrg = Awaited<ReturnType<typeof loadMatchOrgs>>[number];

/** 预加载的匹配上下文，包含索引 */
export interface MatchContext {
  customers: MatchCustomer[];
  organizations: MatchOrg[];
  /** wechat(normalized) → customerId 快速索引 */
  wechatIndex: Map<string, string>;
  /** phone(normalized) → customerId 快速索引 */
  phoneIndex: Map<string, string>;
}

/** 单行匹配结果 */
export interface MatchCandidate {
  customerId: string;
  name: string;
  score: number;
  reason: string;
}

export interface MatchResolution {
  candidates: MatchCandidate[];
  best: MatchCandidate | null;
  status: "MATCHED" | "CONFLICT" | "UNMATCHED";
}
```

### 核心函数设计

#### 1. 数据加载

```typescript
async function loadMatchCustomers() {
  return prisma.customer.findMany({
    where: { deleted: false },
    select: {
      id: true, name: true, wechat: true,
      principal: true, organization: true,
      address: true, organizationId: true,
      org: { select: {
        canonicalName: true, normalizedName: true,
        aliases: { select: { alias: true } },
      }},
    },
  });
}

async function loadMatchOrgs() {
  return prisma.organization.findMany({
    select: {
      id: true, canonicalName: true, normalizedName: true,
      aliases: { select: { alias: true } },
    },
  });
}

/**
 * 创建匹配上下文（含索引）。
 * 每次批量操作只调用一次。
 */
export async function createMatchContext(): Promise<MatchContext> {
  const [customers, organizations] = await Promise.all([
    loadMatchCustomers(),
    loadMatchOrgs(),
  ]);

  const wechatIndex = new Map<string, string>();
  for (const c of customers) {
    const w = normalizeText(c.wechat);
    if (w) wechatIndex.set(w, c.id);
  }

  const phoneIndex = new Map<string, string>();
  for (const c of customers) {
    for (const p of extractPhones(c.principal)) {
      const np = normalizePhone(p);
      if (np) phoneIndex.set(np, c.id);
    }
  }

  return { customers, organizations, wechatIndex, phoneIndex };
}
```

#### 2. 纯匹配函数

```typescript
/**
 * 纯函数：给定上下文和订单快照，返回匹配结果。
 * 无 DB 调用，可直接单元测试。
 */
export function resolveMatch(
  ctx: MatchContext,
  params: {
    buyerPhone?: string | null;
    buyerWechat?: string | null;
    buyerName?: string | null;
    buyerAddress?: string | null;
    buyerOrgName?: string | null;
  },
): MatchResolution {
  const candidates: MatchCandidate[] = [];

  // Layer 1: Wechat — O(1) 哈希查找
  const wechatNorm = normalizeText(params.buyerWechat);
  if (wechatNorm) {
    const hit = ctx.wechatIndex.get(wechatNorm);
    if (hit) {
      const cust = ctx.customers.find(c => c.id === hit)!;
      candidates.push({
        customerId: hit, name: cust.name,
        score: 100, reason: "wechat_exact_match",
      });
    }
  }

  // Layer 2: Phone — O(1) 哈希查找
  if (candidates.length === 0 && params.buyerPhone) {
    const phoneNorm = normalizePhone(params.buyerPhone);
    if (phoneNorm) {
      const hit = ctx.phoneIndex.get(phoneNorm);
      if (hit) {
        const cust = ctx.customers.find(c => c.id === hit)!;
        candidates.push({
          customerId: hit, name: cust.name,
          score: 95, reason: "phone_match_in_principal",
        });
      }
    }
  }

  // Layer 3 & 4 仍需遍历（依赖组合条件）
  // 但仅在 Layer 1/2 未命中时执行
  if (candidates.length === 0) {
    const orderOrgFromAddress = matchOrgAgainstOrderAddress(
      ctx.organizations, params.buyerAddress, params.buyerOrgName,
    );
    // ... 遍历 ctx.customers 做 Layer 3/4 ...
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? null;
  const secondBest = candidates[1];
  const status =
    !best ? "UNMATCHED"
    : !secondBest || best.score - secondBest.score >= 10 ? "MATCHED"
    : "CONFLICT";

  return { candidates, best, status };
}
```

**Layer 1/2 优化效果**：大部分订单通过微信/电话匹配（高频场景），这两层从 O(M) 降为 O(1)。只有少量订单需要遍历全部客户做姓名+地址匹配。

#### 3. 单行兼容包装

```typescript
/**
 * 单行匹配（兼容旧调用方）。
 * 内部创建临时 context，仅适合单行调用。
 * 批量场景请用 createMatchContext() + resolveMatch()。
 */
export async function scanPingoodmiceMatch(params: {
  buyerPhone?: string | null;
  buyerWechat?: string | null;
  buyerName?: string | null;
  buyerAddress?: string | null;
  buyerOrgName?: string | null;
}): Promise<{ customerId: string; matchMethod: string } | null> {
  const ctx = await createMatchContext();
  const result = resolveMatch(ctx, params);
  if (result.status !== "MATCHED") return null;
  return { customerId: result.best!.customerId, matchMethod: result.best!.reason };
}
```

### 路由改造

```typescript
// src/app/api/orders/import/pingoodmice/route.ts

export async function POST(req: NextRequest) {
  // ... auth, parse ...

  // ✅ 一次性加载匹配上下文（2 次 DB 查询，不管多少行）
  const matchCtx = await createMatchContext();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // ...existing logic...

    // ✅ 纯函数匹配，无额外 DB 查询
    const matchResult = resolveMatch(matchCtx, {
      buyerPhone: row.receiverPhone,
      buyerWechat: row.orderUser,
      buyerName: row.receiverName,
      buyerAddress: row.receiverAddress,
      buyerOrgName: row.storeName,
    });

    const matchedCustomerId =
      matchResult.status === "MATCHED"
        ? matchResult.best!.customerId
        : null;

    await prisma.$transaction(async (tx) => {
      // ... existing create logic ...
      // 同时可记录 matchResult.best?.score / .reason
    });
  }
  // ...
}
```

### matchSourceOrders 改造

复用 `createMatchContext` + `resolveMatch`，消除 ~150 行重复代码：

```typescript
export async function matchSourceOrders(
  source: string, orderIds?: string[],
): Promise<MatchScanResult> {
  const orders = await prisma.order.findMany({ /* existing */ });
  const ctx = await createMatchContext();  // 复用

  for (const order of orders) {
    if (order.customerId) continue;

    const result = resolveMatch(ctx, {  // 复用
      buyerPhone: order.buyerPhoneSnapshot,
      buyerWechat: order.buyerWechatSnapshot,
      buyerName: order.buyerNameSnapshot,
      buyerAddress: order.buyerAddressSnapshot,
      buyerOrgName: order.buyerOrgNameSnapshot,
    });

    // 根据 result.status 写库（MATCHED / CONFLICT / UNMATCHED）
    // ...existing write logic, 用 result.candidates 替代内联候选构建...
  }

  return { scanned: orders.length, matched, conflicted, unmatched, details };
}
```

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|:--------:|------|
| `src/lib/finance/pingoodmice-match.ts` | 重构 | 提取 `createMatchContext` + `resolveMatch`；`scanPingoodmiceMatch` 改为薄包装；`matchSourceOrders` 改为复用核心函数 |
| `src/app/api/orders/import/pingoodmice/route.ts` | 修改 | 导入前调用 `createMatchContext()`，循环内用 `resolveMatch()` 替换 `scanPingoodmiceMatch()` |

**不变的文件**：
- `src/lib/finance/types.ts` — `MatchResult` / `MatchScanResult` 类型不变
- 前端页面 — 无影响

---

## 性能对比

### DB 查询次数

| 场景 | 当前 | 优化后 |
|------|:----:|:------:|
| 导入 50 行 | 100 次全表 | **2 次** |
| 导入 200 行 | 400 次全表 | **2 次** |
| 导入 1000 行 | 2000 次全表 | **2 次** |
| matchSourceOrders 200 条 | 2 次全表 | 2 次全表（不变） |

### CPU 复杂度

| 层 | 当前 | 优化后 |
|----|------|--------|
| Layer 1 (Wechat) | O(M) 遍历 | **O(1)** 哈希查找 |
| Layer 2 (Phone) | O(M) 遍历 | **O(1)** 哈希查找 |
| Layer 3 (Name+Org) | O(M) 遍历 | O(M) 遍历（不变，但仅在 1/2 未命中时执行） |
| Layer 4 (Name+Addr) | O(M) 遍历 | O(M) 遍历（不变） |

实测大部分订单通过微信/电话命中 Layer 1/2，所以平均复杂度从 O(N×M) 降为接近 O(N)。

---

## 迁移风险

| 风险 | 级别 | 缓解 |
|------|:----:|------|
| `matchSourceOrders` 行为回归 | 中 | 匹配逻辑完全相同（同一函数），仅数据来源从内联变量改为 `ctx` 参数。写库逻辑不变 |
| `MatchContext` 内存占用 | 低 | 200 客户 × ~1KB = ~200KB，可忽略 |
| 导入过程中新增客户不进入 context | 低 | 导入是只读-写入流程，新客户写入 Order 表不会引入新 Customer。即使有并发新增客户，漏匹配可在 `/finance/order-matching` 手动补 |
| `wechatIndex` 多客户共用同一微信 | 低 | 后写入覆盖先写入（Map.set），行为与当前遍历取最后一个一致 |
| `scanPingoodmiceMatch` 旧调用方兼容 | 无 | 保留原函数签名作为兼容包装 |

---

## 实施步骤

1. **提取纯函数层**：`resolveMatch` + `matchOrgAgainstOrderAddress` + `matchOrgName` 从两个函数中提取为独立函数
2. **添加 MatchContext**：`createMatchContext` + `wechatIndex` / `phoneIndex`
3. **改造 `scanPingoodmiceMatch`**：改为 `createMatchContext() + resolveMatch()` 的薄包装
4. **改造 `matchSourceOrders`**：替换内联匹配逻辑为 `resolveMatch(ctx, ...)`
5. **改造导入路由**：循环前加载 context，循环内用 `resolveMatch`
6. **验证**：`npm run lint`；用测试 CSV 导入，对比匹配结果与改造前一致

预计改动量：~200 行（含删除重复代码 ~150 行）。
