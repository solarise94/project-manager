# 拼好鼠批量客户匹配性能优化实施方案

## 状态

本文是 F-9b 的执行级方案文档，用于替代 `docs/pingoodmice-match-batch-optimization-design.md` 中尚未收敛的草案设计。

目标不是单纯“减少查询次数”，而是在**不改变现有匹配语义**的前提下，完成以下两件事：

1. 把拼好鼠导入批量匹配的全表重复查询从 `2N` 次降到 `2` 次。
2. 把 `src/lib/finance/pingoodmice-match.ts` 内部重复的匹配逻辑收敛为一套共享核心实现，避免后续继续漂移。

本文按“可直接实现”写法组织，默认后续 agent 按本文执行。

实现完成后至少验证：

```bash
npm run lint
```

如时间允许，建议再做一次真实导入 smoke：

```bash
# 使用一份小规模测试 CSV，通过导入页面或 API 做回归验证
```

---

## 一、问题定义

### 1. 当前性能问题

当前拼好鼠导入 API 在逐行处理 CSV 时，每行都会单独调用：

- `scanPingoodmiceMatch()`
- `prisma.customer.findMany(...)`
- `prisma.organization.findMany(...)`

调用链见：

- [src/app/api/orders/import/pingoodmice/route.ts](/home/solarise/project-manage/src/app/api/orders/import/pingoodmice/route.ts:109)
- [src/lib/finance/pingoodmice-match.ts](/home/solarise/project-manage/src/lib/finance/pingoodmice-match.ts:295)

这导致：

1. `N` 行导入会触发 `2N` 次全表查询。
2. 每行还要对全部客户做四层线性匹配。

在 200 行导入时，单是预加载客户/机构就会发生 400 次全表查询。

### 2. 当前代码组织问题

`src/lib/finance/pingoodmice-match.ts` 里存在两套几乎相同的逻辑：

1. `matchSourceOrders()`：用于已有订单做批量扫描匹配。
2. `scanPingoodmiceMatch()`：用于导入时单行预匹配。

重复内容包括：

1. 地址抽取机构名
2. 机构名比对
3. 微信/电话/姓名+机构/姓名+地址四层评分
4. 候选排序与冲突判定

现状位置：

- [src/lib/finance/pingoodmice-match.ts](/home/solarise/project-manage/src/lib/finance/pingoodmice-match.ts:21)
- [src/lib/finance/pingoodmice-match.ts](/home/solarise/project-manage/src/lib/finance/pingoodmice-match.ts:295)

### 3. 草案设计中的关键缺陷

旧草案把 `wechatIndex` / `phoneIndex` 设计成 `Map<string, string>`，这是不安全的。

原因：

1. `Customer.wechat` 不是唯一字段。
2. `Customer.principal` 也不是唯一字段。

见：

- [prisma/schema.prisma](/home/solarise/project-manage/prisma/schema.prisma:163)

如果用单值索引，多个客户共用同一微信/电话时，会把原本应判为 `CONFLICT` 的场景压扁为“最后一个客户 wins”，造成静默误绑客户。这比性能问题更严重。

因此，本方案的第一原则是：

**任何优化都不能改变当前“多候选冲突保留”的语义。**

---

## 二、目标与非目标

## 目标

1. 保持现有四层匹配规则不变。
2. 保持 `MATCHED / CONFLICT / UNMATCHED` 判定规则不变。
3. 保持 `matchSourceOrders()` 的写库行为不变。
4. 让导入路由在一次请求内只加载一次客户和机构。
5. 收敛重复逻辑，减少未来维护成本。

## 非目标

1. 本次不改动匹配评分标准。
2. 本次不引入新数据库索引或 schema 迁移。
3. 本次不把所有“订单导入匹配”统一重构到别的业务模块。
4. 本次不解决“匹配准确率策略升级”问题，只解决性能和代码重复。

---

## 三、设计原则

### 1. 行为兼容优先于复杂度最优

如果某个 O(1) 方案会损失冲突候选信息，就不能采用。

### 2. 匹配核心必须纯函数化

纯函数层应只依赖：

1. 预加载的上下文
2. 当前订单/导入行的快照字段

不得在纯函数内部访问数据库。

### 3. 导入场景与扫描场景共用一套核心匹配器

批量导入和已有订单扫描的差别只应该体现在：

1. 输入来源不同
2. 命中后写库策略不同

不应该体现在复制一份匹配逻辑。

### 4. 冲突必须显式保留

对于微信、电话这类高置信度字段：

1. 如果只有一个客户命中，可以直接作为高分候选。
2. 如果多个客户命中，必须把这些客户都保留为候选，进入统一的排序/冲突判定流程。

---

## 四、推荐实现结构

本次不新建新文件，先在 `src/lib/finance/pingoodmice-match.ts` 内完成结构重组，降低改动面。

最终结构建议如下：

```ts
// 1. 基础 normalize helpers
normalizeText()
normalizePhone()
extractPhones()

// 2. Prisma load helpers
loadMatchCustomers()
loadMatchOrganizations()

// 3. Context builder
createMatchContext()

// 4. Pure matcher helpers
matchOrgAgainstOrderAddress()
matchOrgName()
resolveMatch()

// 5. Adapters
scanPingoodmiceMatch()      // 单行兼容包装
matchSourceOrders()         // 批量订单扫描
```

本次不建议把逻辑抽到 `src/lib/orders/source-order-match.ts` 之外的第三个地方；但必须处理现有 [src/lib/orders/source-order-match.ts](/home/solarise/project-manage/src/lib/orders/source-order-match.ts:16) 的重复实现，避免三套逻辑并存。

推荐策略：

1. 本次先把 `pingoodmice-match.ts` 收敛成唯一真实实现。
2. 检查 `source-order-match.ts` 是否仍被活跃调用。
3. 若仅用于旧导入计划或未接线代码，则在本次文档中标记为后续清理项。
4. 若已有调用链依赖它，则改为薄包装或 re-export 到新的纯函数核心。

---

## 五、数据结构设计

### 1. Prisma 投影类型

建议使用本地 infer 类型，避免手写漂移：

```ts
type MatchCustomer = Awaited<ReturnType<typeof loadMatchCustomers>>[number];
type MatchOrganization = Awaited<ReturnType<typeof loadMatchOrganizations>>[number];
```

### 2. 上下文结构

关键点：索引必须保存**多候选**，不能保存单值。

```ts
export interface MatchContext {
  customers: MatchCustomer[];
  organizations: MatchOrganization[];

  // customerId -> customer，供 O(1) 取对象
  customerById: Map<string, MatchCustomer>;

  // normalized wechat -> customerIds[]
  wechatIndex: Map<string, string[]>;

  // normalized phone -> customerIds[]
  phoneIndex: Map<string, string[]>;
}
```

说明：

1. `customerById` 用于避免 `Map` 命中后再次 `Array.find()`。
2. `wechatIndex` / `phoneIndex` 用数组保留所有命中客户。
3. 这样既保留冲突语义，也能把 Layer 1/2 的“候选发现”降为近似 O(1)。

### 3. 候选结构

建议统一成：

```ts
export interface ResolvedCandidate {
  customerId: string;
  name: string;
  score: number;
  reason: string;
}

export interface MatchResolution {
  candidates: ResolvedCandidate[];
  best: ResolvedCandidate | null;
  status: "MATCHED" | "CONFLICT" | "UNMATCHED";
}
```

说明：

1. `candidates` 保留完整排序结果，至少前 3 个会被 `matchSourceOrders()` 用于 conflict 记录。
2. `best` 只用于方便调用方读取最高分候选。

---

## 六、核心算法设计

### 1. createMatchContext()

职责：

1. 一次性加载客户
2. 一次性加载机构
3. 构建哈希索引

伪代码：

```ts
function pushIndex(map: Map<string, string[]>, key: string, customerId: string) {
  const list = map.get(key);
  if (list) list.push(customerId);
  else map.set(key, [customerId]);
}

export async function createMatchContext(): Promise<MatchContext> {
  const [customers, organizations] = await Promise.all([
    loadMatchCustomers(),
    loadMatchOrganizations(),
  ]);

  const customerById = new Map<string, MatchCustomer>();
  const wechatIndex = new Map<string, string[]>();
  const phoneIndex = new Map<string, string[]>();

  for (const customer of customers) {
    customerById.set(customer.id, customer);

    const wechat = normalizeText(customer.wechat);
    if (wechat) {
      pushIndex(wechatIndex, wechat, customer.id);
    }

    for (const rawPhone of extractPhones(customer.principal)) {
      const phone = normalizePhone(rawPhone);
      if (phone) {
        pushIndex(phoneIndex, phone, customer.id);
      }
    }
  }

  return {
    customers,
    organizations,
    customerById,
    wechatIndex,
    phoneIndex,
  };
}
```

### 2. Layer 1/2：索引命中

行为要求：

1. 不能命中一个就立刻返回。
2. 必须把命中的所有客户加入候选池。
3. 若同一客户因多个来源重复命中，要去重。

推荐做法：

```ts
function addIndexedCandidates(
  ids: string[] | undefined,
  score: number,
  reason: string,
  ctx: MatchContext,
  seen: Set<string>,
  candidates: ResolvedCandidate[],
) {
  if (!ids) return;
  for (const id of ids) {
    if (seen.has(id)) continue;
    const customer = ctx.customerById.get(id);
    if (!customer) continue;
    seen.add(id);
    candidates.push({
      customerId: customer.id,
      name: customer.name,
      score,
      reason,
    });
  }
}
```

### 3. Layer 3/4：保留原遍历逻辑

这两层仍然需要遍历全部客户，因为它们依赖组合条件：

1. 姓名 + 机构
2. 姓名 + 地址

但可以做两点优化：

1. `orderName` / `orderPhone` / `orderAddr` / `orderWechat` 等归一化字段只算一次。
2. 若 Layer 1 已产生 `100` 分候选，理论上 Layer 3/4 不可能再超过它，但为了保持当前“多同分冲突可见”的语义，仍建议保留统一候选收集逻辑，不做激进短路。

### 4. 统一排序与状态决策

排序规则保持不变：

```ts
candidates.sort((a, b) => b.score - a.score);
```

状态判定保持不变：

1. 无候选：`UNMATCHED`
2. 仅一个候选：`MATCHED`
3. 第一名与第二名分差 `>= 10`：`MATCHED`
4. 否则：`CONFLICT`

### 5. resolveMatch() 职责边界

`resolveMatch(ctx, params)` 只负责：

1. 收集候选
2. 排序
3. 输出状态

它不负责：

1. 写 `Order.customerId`
2. 写 `customerMatchStatus`
3. 写 `representativeId`

这些属于调用方职责。

---

## 七、调用方改造方案

## A. 改造导入路由

文件：

- [src/app/api/orders/import/pingoodmice/route.ts](/home/solarise/project-manage/src/app/api/orders/import/pingoodmice/route.ts:1)

### 目标

把“循环内每行调用 `scanPingoodmiceMatch()`”改成“循环前创建 context，循环内只调用纯函数 `resolveMatch()`”。

### 具体改法

#### 1. 导入新增依赖

从：

```ts
import { scanPingoodmiceMatch } from "@/lib/finance/pingoodmice-match";
```

改为：

```ts
import { createMatchContext, resolveMatch } from "@/lib/finance/pingoodmice-match";
```

#### 2. 在循环前创建 context

位置：`rows.length` 校验后、进入 `for` 循环前。

```ts
const matchContext = await createMatchContext();
```

#### 3. 循环内执行纯匹配

```ts
const matchResult = resolveMatch(matchContext, {
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
```

#### 4. 写入逻辑保持现有语义

导入路由目前只区分：

1. 命中唯一客户 -> 写 `customerId`
2. 否则 -> 不写 `customerId`

本次继续保持，不在导入事务里额外记录复杂 conflict JSON。因为当前导入路由本来也没有这样做。

建议保持：

```ts
customerId: matchedCustomerId,
customerMatchStatus: matchedCustomerId ? "AUTO_MATCHED" : "UNMATCHED",
customerMatchReason: matchedCustomerId
  ? `auto_matched_by_${matchResult.best!.reason}`
  : null,
```

注意：

1. 当 `resolveMatch()` 返回 `CONFLICT` 时，导入路由仍写 `UNMATCHED`，这与当前 `scanPingoodmiceMatch()` 返回 `null` 的语义一致。
2. 本次不扩大导入行为，不在这里引入新状态或冲突候选持久化。

## B. 改造 scanPingoodmiceMatch()

文件：

- [src/lib/finance/pingoodmice-match.ts](/home/solarise/project-manage/src/lib/finance/pingoodmice-match.ts:295)

### 目标

保留旧签名，改成兼容包装，避免外部调用方断裂。

目标实现：

```ts
export async function scanPingoodmiceMatch(params: MatchInput) {
  const ctx = await createMatchContext();
  const result = resolveMatch(ctx, params);
  if (result.status !== "MATCHED" || !result.best) return null;
  return {
    customerId: result.best.customerId,
    matchMethod: result.best.reason,
  };
}
```

说明：

1. 该函数仍会做 2 次查询。
2. 但它只作为单行兼容包装存在。
3. 批量场景不再使用它。

## C. 改造 matchSourceOrders()

文件：

- [src/lib/finance/pingoodmice-match.ts](/home/solarise/project-manage/src/lib/finance/pingoodmice-match.ts:21)

### 目标

让 `matchSourceOrders()` 复用同一套核心匹配逻辑，同时保持其现有写库行为不变。

### 必须保持不变的行为

1. `UNMATCHED` 时清空 `representativeId`
2. `CONFLICT` 时写 top 3 候选 JSON 到 `customerMatchReason`
3. `MATCHED` 时仍通过 `resolveCustomerRepresentative()` 回填 `representativeId`
4. `details` 返回格式保持兼容

### 具体改法

1. 先查询订单列表
2. 再一次性 `createMatchContext()`
3. 每个订单调用 `resolveMatch(ctx, snapshots)`
4. 根据 `result.status` 进入当前三路写库分支

关键点：

1. `result.candidates` 必须包含姓名，供 `details` 直接输出。
2. `result.candidates.slice(0, 3)` 必须能直接替代当前 conflict 分支逻辑。

---

## 八、与现有 `source-order-match.ts` 的关系

文件：

- [src/lib/orders/source-order-match.ts](/home/solarise/project-manage/src/lib/orders/source-order-match.ts:1)

当前仓库里已经存在另一套导入匹配 helper，但它的逻辑和 `pingoodmice-match.ts` 并不完全一致：

1. 它没有地址提取机构名的那套优先级逻辑。
2. 它返回的是“最佳命中”，不是“候选列表 + 冲突状态”。
3. 它不适合直接替代 `matchSourceOrders()`。

因此本次建议：

1. **不要**以它为核心直接替换 `pingoodmice-match.ts`。
2. 在本文执行范围内，以 `pingoodmice-match.ts` 收敛为唯一正确实现。
3. 实施完成后补一个 follow-up：
   - 若 `source-order-match.ts` 无实际调用价值，删除。
   - 若有调用方依赖，改成基于 `resolveMatch()` 的薄包装。

本次不建议留下“三套类似但不一致的匹配实现”。

---

## 九、复杂度与收益说明

## 1. 查询次数

### 导入场景

当前：

1. `N` 行 CSV
2. 每行 `customer.findMany` 1 次
3. 每行 `organization.findMany` 1 次

总计：`2N` 次全表查询

优化后：

1. 整个请求只做一次 `customer.findMany`
2. 整个请求只做一次 `organization.findMany`

总计：`2` 次全表查询

示例：

| 导入行数 | 当前 | 优化后 |
|----------|:----:|:------:|
| 50 | 100 次 | 2 次 |
| 200 | 400 次 | 2 次 |
| 1000 | 2000 次 | 2 次 |

## 2. CPU 复杂度

严格说，整体复杂度仍不是纯 O(N)，因为 Layer 3/4 仍可能遍历全部客户。

更准确的表述应为：

1. Layer 1/2 的**候选发现**从全表扫描降为索引访问。
2. Layer 3/4 保持全表遍历。
3. 实际平均成本取决于微信/电话命中率。

因此文档里不要写“整体变成 O(N)”这种过强表述，应写成：

**高频的微信/电话匹配成本显著下降，批量导入的总延迟主要受 Layer 3/4 占比影响。**

---

## 十、风险与缓解

| 风险 | 级别 | 说明 | 缓解 |
|------|:----:|------|------|
| 多客户共享微信/电话被误绑 | 高 | 单值索引会破坏冲突语义 | 使用 `Map<string, string[]>` 保留多候选 |
| `matchSourceOrders()` 行为回归 | 中 | conflict JSON / detail 输出可能漂移 | 保持返回结构一致，并做前后对比样例 |
| 与 `source-order-match.ts` 继续漂移 | 中 | 仓库保留另一套近似逻辑 | 实施后明确 follow-up：包装或删除 |
| 内存占用上升 | 低 | 单次请求缓存全量客户和机构 | 当前客户规模下可接受，且远低于重复查询成本 |
| 并发期间新增客户未进入本次 context | 低 | 导入时 context 是请求级快照 | 与当前行为等价，可通过后续手工匹配补救 |

---

## 十一、实施步骤

建议按下面顺序提交，降低调试难度。

### Step 1

在 `src/lib/finance/pingoodmice-match.ts` 中提取公共 helper：

1. `loadMatchCustomers()`
2. `loadMatchOrganizations()`
3. `matchOrgAgainstOrderAddress()`
4. `matchOrgName()`

### Step 2

新增 `MatchContext` 与 `createMatchContext()`：

1. `customers`
2. `organizations`
3. `customerById`
4. `wechatIndex`
5. `phoneIndex`

### Step 3

新增纯函数 `resolveMatch(ctx, params)`：

1. 输入为快照字段
2. 输出 `MatchResolution`
3. 无任何 DB 调用

### Step 4

把 `scanPingoodmiceMatch()` 改为兼容包装。

### Step 5

把 `matchSourceOrders()` 改为：

1. 一次性创建 context
2. 循环内调用 `resolveMatch()`
3. 保持原三路写库逻辑

### Step 6

把导入路由改为：

1. 循环前创建 context
2. 循环内调用 `resolveMatch()`
3. 不再调用 `scanPingoodmiceMatch()`

### Step 7

处理 `source-order-match.ts`：

1. 先确认是否有实际调用
2. 如有调用，改成基于 `resolveMatch()` 的包装
3. 如无调用，记入后续清理任务

---

## 十二、验证矩阵

本次必须补齐“行为等价”验证，不能只看 lint。

## A. 纯函数回归样例

建议至少构造以下样例：

1. **唯一微信命中**
   - 期望：`MATCHED`
   - 原因：`wechat_exact_match`

2. **两个客户共用同一微信**
   - 期望：`CONFLICT`
   - 不能退化成“最后一个 wins”

3. **唯一电话命中**
   - 期望：`MATCHED`
   - 原因：`phone_match_in_principal`

4. **两个客户 principal 都含同一电话**
   - 期望：`CONFLICT`

5. **姓名 + 机构精确命中**
   - 期望：`MATCHED`

6. **姓名相同但地址都重叠**
   - 期望：按分差规则决定，若同分则 `CONFLICT`

7. **完全无候选**
   - 期望：`UNMATCHED`

## B. matchSourceOrders 回归

至少验证：

1. `MATCHED` 时仍回填 `representativeId`
2. `CONFLICT` 时 `customerMatchReason` 仍写 top 3 候选 JSON
3. `UNMATCHED` 时仍清空 `representativeId`
4. `details` 输出字段不变

## C. 导入路由回归

至少验证：

1. 200 行导入不再触发每行 2 次全表查询
2. 唯一命中客户的订单会自动写入 `customerId`
3. 冲突订单仍不会自动绑定 `customerId`
4. 未命中订单保持 `UNMATCHED`

## D. 命令验证

至少执行：

```bash
npm run lint
```

如本次顺带补了测试，也应执行对应测试命令；若仓库仍无测试框架，则在变更说明里明确这一点。

---

## 十三、完成标准

满足以下条件，才算 F-9b 完成：

1. 导入路由批量场景只创建一次 `MatchContext`
2. `scanPingoodmiceMatch()` 仍可兼容单行调用
3. `matchSourceOrders()` 与导入路由共用同一套纯匹配核心
4. 多客户共享微信/电话时不发生静默误绑
5. `npm run lint` 通过
6. 至少完成一组真实导入或构造样例回归验证

---

## 十四、后续项

本次不强制实现，但建议列入后续任务：

1. 为 `resolveMatch()` 补最小单元测试能力
2. 清理或包装 `src/lib/orders/source-order-match.ts`
3. 若未来导入渠道继续扩展，把该 matcher 抽成真正的共享订单导入匹配模块
4. 若冲突订单在导入阶段也需要可审计候选，可再考虑把导入场景的 conflict 细节持久化
