# 订单导入来源脱敏与备注化改造方案

## 背景

当前订单导入链路把“来源”同时承担了三种职责：

1. 内部稳定标识：用于幂等去重、匹配、筛选、统计。
2. 用户可见文案：页面上直接展示“拼好鼠”等品牌名。
3. 导入输入项：用户在导入页手工选择来源。

这三层职责耦合后，带来两个问题：

1. 不利于系统对外分发。品牌名、平台名、特定内部代号在页面文案、路由名、函数名中暴露较多。
2. 不能简单把 `source` 改成自由文本备注。`source` 已经参与唯一键和导入幂等，直接放开会破坏去重和更新逻辑。

因此本次改造目标不是“把 source 删掉”，而是：

1. 保留内部稳定 `source` 标识，继续服务于技术约束。
2. 新增用户可编辑的“来源备注 / 导入备注”字段，替代导入页的来源选择。
3. 在 UI、菜单、页面标题、公开入口中完成品牌脱敏。
4. 视需要再决定是否做第二阶段内部命名迁移。

## 当前现状

### 数据层

- `Order.source` 用于订单来源枚举。
- `OrderSourceRecord.source` 用于来源记录。
- `OrderSourceRecord` 依赖 `@@unique([source, externalOrderNo])` 做导入幂等。
- `Order` 也有 `@@index([source, externalOrderNo])`，大量筛选和统计依赖此字段。

### 前端输入

- `src/app/orders/import/page.tsx` 使用 `Select` 让用户选择 `PINGOODMICE` / `OTHER_IMPORT`。
- `preview` / `ai-normalize` / `commit` 三个接口都直接接收这个 `source`。

### 文案暴露

- Dashboard、财务页、订单列表、订单详情、匹配页等大量位置直接显示“拼好鼠”。
- 公开路由仍存在 `/orders/import/pingoodmice`、相关跳转和页面标题。

### 内部命名扩散

- `PINGOODMICE` 已扩散到常量、函数名、文件名、API 路径。
- 如果直接全量重命名，会波及 schema、历史数据、查询参数、兼容跳转、导入幂等和财务匹配链路。

## 设计原则

1. 先做“展示脱敏”和“输入改造”，不先做内部枚举值迁移。
2. 内部 `source` 必须保持稳定，不能让用户自由输入。
3. 用户自由输入的内容必须落到新字段，不能复用 `source`。
4. 品牌脱敏优先覆盖 UI、页面标题、公开入口、导出文案。
5. 内部函数名和文件名是否迁移，作为第二阶段可选项，不和第一阶段绑定上线。

## 目标方案

### 核心字段拆分

保留：

- `Order.source`
- `OrderSourceRecord.source`

新增建议：

- `Order.sourceRemark: String?`
- `OrderSourceRecord.sourceRemark: String?`

字段职责：

- `source`：内部稳定来源代码，只给系统使用。
- `sourceRemark`：用户填写的来源备注，面向展示、检索、审计。

### 内部来源枚举策略

建议不要在第一阶段把 `PINGOODMICE` 从数据层彻底删掉。

推荐策略：

1. 第一阶段保持现有枚举值不变。
2. 新增统一展示层，把 `PINGOODMICE` 对外显示为“平台导入”或“电商导入”。
3. 第二阶段如果确实需要源码也脱敏，再评估把内部值迁移为更中性的 `MARKETPLACE_IMPORT`。

## 执行 Phase

## Phase 1：数据模型扩展

### 目标

为“来源备注”提供独立存储，不影响现有 `source` 语义。

### 修改内容

修改 `prisma/schema.prisma`：

- `Order` 新增 `sourceRemark String?`
- `OrderSourceRecord` 新增 `sourceRemark String?`

可选：

- 若后续需要按备注搜索，可增加：
  - `@@index([sourceRemark])` 不建议立即加，SQLite 下收益有限，可按实际查询再定。

### 数据迁移策略

因为项目当前开发习惯以 `prisma db push` 为主，可直接执行：

1. 修改 schema
2. `npx prisma db push`
3. `npx prisma generate`

### 验收标准

- schema 变更不影响现有查询和写入。
- 历史订单 `sourceRemark` 为空时页面正常展示。

## Phase 2：导入接口改造

### 目标

把“用户输入的来源”从枚举选择改为自由备注，但保留内部稳定 `source`。

### 接口范围

- `src/app/api/orders/import/preview/route.ts`
- `src/app/api/orders/import/ai-normalize/route.ts`
- `src/app/api/orders/import/commit/route.ts`

### 设计方案

现有请求体中的：

- `source`

改造为双字段：

- `importChannel`：内部固定渠道代码，前端可不展示，默认给后端固定值
- `sourceRemark`：用户输入备注

兼容策略：

第一阶段可以保留 `source` 参数，但前端不再让用户选择，仅内部默认传值。

建议后端处理逻辑：

1. `source` 缺省时默认为 `OTHER_IMPORT` 或中性的固定渠道值。
2. `sourceRemark` 缺省时为 `null`。
3. `parseOrderText(source, rawText)` 继续使用稳定 `source`。
4. `commit` 写入 `order.sourceRemark` 和 `orderSourceRecord.sourceRemark`。

### 关键约束

不能把：

- `normalizeOrderSource(row.source)`

替换为：

- 用户输入备注

否则会破坏：

- `source + externalOrderNo` 唯一键
- 幂等更新
- 同源订单识别

### 验收标准

- 用户不再需要选择品牌来源。
- 同一文件重复导入仍能命中更新，不会产生重复订单。
- 备注可成功写入订单和来源记录。

## Phase 3：导入页前端改造

### 目标

导入页不再暴露品牌来源下拉，改为填写备注。

### 页面范围

- `src/app/orders/import/page.tsx`

### 修改方案

删除：

- `SOURCES` 常量
- “来源” `Select`

新增：

- `sourceRemark` 的 `Input` 或 `Textarea`

建议交互：

- 标签：`来源备注`
- placeholder：`例如：客户转发表格、平台后台导出、合作方提供`
- 帮助文案：`仅作为备注展示，不影响系统去重和导入匹配`

内部传参：

- `source` 固定为默认导入渠道
- `sourceRemark` 由用户填写

### AI 规范化页说明

AI 规范化、预览、正式导入都继续复用同一份备注值，但备注不参与字段识别。

### 验收标准

- 页面上不再出现“拼好鼠”“OTHER_IMPORT”等选择项。
- 用户可以自由填写备注。
- 预览、AI 规范化、导入三步之间备注值保持一致。

## Phase 4：统一来源展示层

### 目标

统一所有页面对来源的对外展示，避免继续散落品牌名硬编码。

### 建议新增

新增文件：

- `src/lib/orders/source-labels.ts`

建议提供：

```ts
export function getOrderSourceLabel(source: string): string
export function getOrderSourcePublicLabel(source: string): string
```

建议映射：

- `MANUAL -> 手动`
- `PINGOODMICE -> 平台导入`
- `OTHER_IMPORT -> 外部导入`

如果需要同时展示备注：

- 优先展示 `sourceRemark`
- 否则展示 `getOrderSourcePublicLabel(source)`

### 替换范围

至少覆盖：

- `src/app/orders/page.tsx`
- `src/app/orders/[id]/page.tsx`
- `src/app/finance/customers/[customerId]/page.tsx`
- `src/components/orders/order-edit-dialog.tsx`
- 其他所有 `SOURCE_LABELS` 本地常量

### 验收标准

- 页面不再直接显示“拼好鼠”。
- 来源展示逻辑统一，不再各页维护私有字典。

## Phase 5：公开入口和页面文案脱敏

### 目标

把用户可见入口、卡片、标题、描述改成中性表述。

### 优先修改点

#### 入口与导航

- `src/app/dashboard/page.tsx`
- `src/app/finance/page.tsx`
- `src/app/orders/page.tsx`

文案建议：

- `拼好鼠订单` -> `平台订单`
- `拼好鼠订单匹配` -> `导入订单匹配`
- `查看拼好鼠平台订单` -> `查看导入平台订单`

#### 页面标题

- `src/app/finance/order-matching/page.tsx`
- `src/app/orders/import/page.tsx`

建议标题：

- `导入订单匹配`
- `订单导入`

#### 跳转页

- `src/app/external-orders/page.tsx`
- `src/app/orders/import/pingoodmice/page.tsx`

### 路由策略

不要第一阶段直接删除旧路由。

建议：

1. 保留旧路由，用于兼容历史链接。
2. 旧路由只做 `router.replace()` 到新中性入口。
3. 所有新按钮和菜单都指向新入口。

可选新路由：

- `/orders/import/platform`
- `/finance/order-import-matching`

如果不想新增长路径，也可以直接统一到：

- `/orders/import`
- `/finance/order-matching`

仅修改标题和入口文案。

### 验收标准

- 主导航、入口卡片、页面标题不再暴露品牌名。
- 历史旧链接仍可访问并正确跳转。

## Phase 6：订单详情与来源记录展示优化

### 目标

让用户在列表和详情里看到“备注化来源”，而不是内部来源码。

### 修改建议

#### 订单列表

- 来源列优先显示 `sourceRemark`
- 若为空，显示统一中性 label

#### 订单详情

- 概览中的“来源”拆成：
  - `导入渠道`：平台导入 / 外部导入 / 手动
  - `来源备注`：用户填写内容

#### 来源记录 tab

- `source` 仍保留给内部排查
- 对普通展示默认显示中性 label
- 增加 `备注` 一列或字段

### 验收标准

- 业务用户看到的是备注和中性渠道描述。
- 内部排查时仍能追踪原始 source code。

## Phase 7：搜索与筛选策略调整

### 目标

避免“来源筛选”继续暴露品牌值，同时保留查询能力。

### 建议方案

第一阶段：

- 保留后台内部筛选参数 `source`
- UI 筛选文案改中性：
  - `PINGOODMICE` 展示为 `平台导入`

第二阶段可选：

- 增加 `sourceRemark` 搜索
- 支持列表按备注全文匹配

### 注意

不要在第一阶段移除 `source` 筛选，否则会影响已有订单筛选和财务工作流。

## Phase 8：内部命名脱敏（可选二期）

### 目标

如果需要对源码分发或减少内部品牌暴露，再考虑这一步。

### 涉及范围

- `ORDER_SOURCE.PINGOODMICE`
- `normalizeOrderSource`
- `pingoodmice-match.ts`
- `/api/orders/import/pingoodmice`
- `/api/finance/pingoodmice/match-scan`
- 各类 `?source=PINGOODMICE` 深链

### 风险

这是高风险迁移，不建议和第一阶段一起做。

原因：

1. 影响 schema 中已有历史值。
2. 影响导入幂等唯一键。
3. 影响筛选 URL 参数和历史书签。
4. 影响旧接口兼容。
5. 影响财务匹配和订单统计。

### 如果必须做

需要单独设计迁移方案：

1. schema/data migration：把历史值批量改成中性值
2. 后端兼容：老参数 `PINGOODMICE` 仍能识别
3. 前端兼容：旧深链自动映射
4. 回归验证：导入、匹配、筛选、去重、财务统计全量复核

## 不建议的做法

以下方案不要执行：

1. 直接把 `Order.source` 改成用户输入的自由文本。
2. 直接删除 `PINGOODMICE` 内部值但不做数据迁移。
3. 先全量重命名文件/函数/API，再回头补 UI 脱敏。
4. 在没有统一 label helper 的情况下逐页手工替换文案。

## 推荐实施顺序

推荐按以下顺序交给 DeepSeek：

1. Phase 1：schema 新增 `sourceRemark`
2. Phase 2：导入接口支持 `sourceRemark`
3. Phase 3：导入页改为备注输入
4. Phase 4：抽统一来源 label helper
5. Phase 5：入口和标题脱敏
6. Phase 6：订单列表/详情/来源记录展示备注
7. Phase 7：按需补搜索和筛选
8. Phase 8：仅在必须时再做内部命名迁移

## 回归测试清单

### 导入流程

1. 粘贴文本导入，填写来源备注，预览成功。
2. 文件导入，填写来源备注，预览成功。
3. AI 规范化后继续导入，备注保留。
4. 同一文件重复导入，命中更新，不产生重复订单。

### 展示与筛选

1. 订单列表不再显示“拼好鼠”。
2. 订单详情来源区块显示中性渠道和备注。
3. 来源记录可看到备注。
4. 来源筛选仍可正常过滤平台导入订单。

### 兼容性

1. 旧入口 `/orders/import/pingoodmice` 仍可跳转。
2. 旧订单历史数据未填写备注时展示正常。
3. 财务匹配页、客户财务页、订单详情页没有品牌名泄露。

### 稳定性

1. `npm run lint` 无新增 error。
2. `npx tsc --noEmit` 通过。
3. 至少手工验证一轮订单导入、导入更新、订单列表筛选、匹配页跳转。

## 建议给 DeepSeek 的落地口径

可以直接按下面原则执行：

1. 第一阶段不改内部枚举值 `PINGOODMICE`，只做展示脱敏和备注新增。
2. 所有面向用户的来源展示统一改成中性文案。
3. 导入页去掉来源选择，新增来源备注输入。
4. 新增 `sourceRemark` 贯通 `Order`、`OrderSourceRecord`、导入接口、订单列表、订单详情。
5. 历史 `pingoodmice` 路由和接口先保留兼容，不做破坏式删除。

