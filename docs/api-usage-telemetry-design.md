# API 使用习惯采集后台设计

## 状态

本文是 SciManage 的一版设计文档，不包含代码实现。

目标是增加一个面向 ADMIN 的“用户使用习惯采集后台”，核心关注：

1. 用户实际调用了哪些 API。
2. 各 API 的调用频率、趋势和角色差异。
3. 某些能力是否已经有后端能力，但前端入口弱、入口深或交互导致重复请求。
4. 哪些 API 很少被用到，可以据此优化 UI 信息架构、入口布局和操作流。

---

## 一、设计目标

### 1.1 要解决的问题

当前系统已经有较多 API 路由和业务能力，但“后端已具备能力”和“前端是否被用户高效使用”之间并不透明。

现阶段缺少以下视角：

1. 哪些 API 是高频核心路径。
2. 哪些 API 只被极少数页面或极少数角色使用。
3. 某些页面是否因为筛选器、Tabs、表格刷新或详情抽屉切换，产生了过多重复请求。
4. 某些后端能力是否长期低使用，说明 UI 入口太深、命名不清、心智不匹配，或功能本身不值得继续投入。

### 1.2 本方案的目标

第一版只做“产品分析采集”，不做增长分析，不做广告式埋点，不追踪用户隐私内容。

第一版产出应支持：

1. 按 API 路由模板查看 7 天、30 天、90 天调用频率。
2. 按角色查看使用差异，例如 `ADMIN`、`USER`、`REPRESENTATIVE`。
3. 按 UI 来源查看请求来自哪个页面或哪个操作入口。
4. 区分“真实用户 UI 行为”和“系统内部调用 / agent 调用 / 框架噪音”。
5. 给前端改版提供依据，而不是凭感觉调 UI。

### 1.3 非目标

第一版明确不做：

1. 不记录请求 body / 响应 body。
2. 不记录自由文本搜索词、聊天内容、表单内容。
3. 不做用户画像、兴趣画像或跨系统跟踪。
4. 不做逐用户行为回放。
5. 不把它设计成通用审计系统；业务审计仍由现有 `ActivityLog`、`AgentActionLog` 等承担。

---

## 二、核心设计原则

### 2.1 聚焦“路线与入口”，不是内容监控

我们关心的是：

1. 某能力是否被触达。
2. 从哪个页面、哪个入口触达。
3. 触达频率是否异常高或异常低。

我们不关心用户具体输入了什么内容。

### 2.2 路由模板优先，避免按资源 ID 打散

统计必须基于路由模板，而不是原始 URL。

例如：

1. `/api/orders/ckabc123` 归一为 `/api/orders/[id]`
2. `/api/orders/ckabc123/project-links` 归一为 `/api/orders/[id]/project-links`
3. `/api/crm/profiles/xxx/interactions` 归一为 `/api/crm/profiles/[id]/interactions`

否则统计会被海量具体 ID 打散，无法用于产品决策。

### 2.3 人类用户流量与系统流量分开

如果不拆分来源，以下噪音会严重污染结果：

1. `/api/auth/session` 这类框架轮询。
2. `/api/internal/*` 定时任务。
3. `/api/agent/*` 的内部工具执行。
4. 上传、转写、后台同步、提醒扫描等系统行为。

因此采集结果必须至少区分：

1. `HUMAN_UI`
2. `SYSTEM_INTERNAL`
3. `AGENT_RUNTIME`
4. `FRAMEWORK_NOISE`

产品分析默认只看 `HUMAN_UI`。

### 2.4 先保守采集，再逐步增强

第一版优先保证：

1. 低侵入。
2. 可解释。
3. 不明显拖慢主业务 API。
4. 不引入隐私风险。

不追求一开始就做到事件级漏斗平台。

---

## 三、建议采集范围

### 3.1 第一版纳入统计的 API

建议优先覆盖直接对应用户产品操作的业务 API：

1. `/api/projects/**`
2. `/api/orders/**`
3. `/api/customers/**`
4. `/api/crm/**`
5. `/api/finance/**`
6. `/api/tickets/**`
7. `/api/organizations/**`
8. `/api/representatives/**`
9. `/api/plugins/**`

### 3.2 第一版默认排除

以下路由默认不进入“产品使用习惯”主报表，避免噪音：

1. `/api/auth/**`
2. `/api/internal/**`
3. `/api/runtime-info`
4. `/api/me`
5. `/api/notifications/**`
6. `/api/reminders/**`
7. `/api/draft-media/**`
8. `/api/agent/**`
9. 上传、下载、转写、健康检查类接口

这些数据如果后续需要，可以单独做“系统运行指标”报表，不和 UI 行为混在一起。

### 3.3 特殊处理路由

有些接口虽然是业务接口，但不适合直接按“使用频率”理解，需要附带标签：

1. 列表查询接口，例如 `/api/orders`、`/api/crm/profiles`
2. 详情查询接口，例如 `/api/orders/[id]`
3. 选项/字典接口，例如 `/api/projects/filter-options`
4. 批量动作接口，例如 `/api/orders/merge`、`/api/orders/batch-delete`
5. AI / 草稿辅助接口，例如 `/api/projects/[id]/invoice-draft`

这些分类建议作为 route catalog 元数据保存，便于后台做分组分析。

---

## 四、采集口径

### 4.1 基础统计维度

每次命中受监控 API 时，建议至少记录以下维度：

1. `routeKey`
2. `method`
3. `statusGroup`
4. `durationBucket`
5. `actorType`
6. `actorRole`
7. `uiSurface`
8. `uiAction`
9. `clientVisitId`
10. `occurredAt`

字段含义如下：

| 字段 | 说明 |
| --- | --- |
| `routeKey` | 归一化后的路由模板，例如 `/api/orders/[id]` |
| `method` | `GET` / `POST` / `PATCH` / `DELETE` |
| `statusGroup` | `2xx` / `4xx` / `5xx` |
| `durationBucket` | `<100ms`、`100-300ms`、`300-1000ms`、`1-3s`、`>3s` |
| `actorType` | `HUMAN_UI` / `SYSTEM_INTERNAL` / `AGENT_RUNTIME` / `FRAMEWORK_NOISE` |
| `actorRole` | `ADMIN` / `USER` / `REPRESENTATIVE` / `ANON` |
| `uiSurface` | 请求来自哪个页面或模块 |
| `uiAction` | 请求由哪个前端动作触发 |
| `clientVisitId` | 同一次访问会话的匿名 visit id，用于估算重复请求 |
| `occurredAt` | 请求发生时间 |

### 4.2 `uiSurface` 口径

`uiSurface` 用来回答“这个 API 是从哪里触发的”。

建议取值规范化，例如：

1. `orders.list`
2. `orders.detail`
3. `orders.new`
4. `projects.detail`
5. `crm.dashboard`
6. `crm.customer.detail`
7. `finance.invoices`
8. `mobile.nav`
9. `unknown`

这比只记录 pathname 更适合长期分析，因为页面 URL 可能有动态参数或后续改名。

### 4.3 `uiAction` 口径

`uiAction` 用来回答“用户在页面里做了什么动作后触发了这个 API”。

建议取值例如：

1. `page_load`
2. `filter_change`
3. `tab_change`
4. `pagination`
5. `open_detail`
6. `create_submit`
7. `edit_submit`
8. `bind_project`
9. `generate_ai_draft`
10. `auto_refresh`
11. `unknown`

这样可以区分：

1. 某接口高频是因为页面初始化一定会调一次。
2. 还是因为用户反复切筛选器导致频繁触发。
3. 还是因为 UI 设计造成重复拉取。

### 4.4 `clientVisitId` 的作用

仅看请求总数容易误判。

例如：

1. 一个接口 500 次请求，可能是 500 个不同用户各调用 1 次。
2. 也可能是 10 个用户在一个页面里反复触发。

引入匿名 `clientVisitId` 后，可以推导：

1. 每访问会话平均请求数。
2. 每页面平均触发次数。
3. 某些页面是否存在异常重复请求。

`clientVisitId` 只用于匿名聚合，不要求跨设备统一身份。

### 4.5 查询参数处理

不建议原样记录 query string。

建议采用“白名单 + 形状化”策略：

1. 允许记录：`page`、`pageSize`、`tab`、`status`、`source`、`sort`
2. 不记录：`q`、`keyword`、`name`、`phone`、`email`、任意自由文本

如果需要分析筛选使用情况，可只记录键名和离散枚举值，不记录原始搜索文本。

例如：

1. 保留 `status=REQUESTED`
2. 保留 `tab=finance`
3. 不保留 `q=北京大学张三`

---

## 五、数据模型建议

第一版建议采用“短期原始事件 + 长期聚合表”双层模型。

原因：

1. 只存原始事件，长期体量会变大，后台查询也会慢。
2. 只存聚合结果，又会失去后续调整口径的灵活性。

### 5.1 原始事件表：`ApiUsageEvent`

用途：

1. 保存近 7 到 14 天原始事件。
2. 支持后续 rollup 修正口径。
3. 支持排查单个 route 突然异常增长。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `occurredAt` | 事件时间 |
| `routeKey` | 路由模板 |
| `method` | HTTP 方法 |
| `statusCode` | 原始状态码 |
| `statusGroup` | `2xx` / `4xx` / `5xx` |
| `durationMs` | 响应耗时 |
| `durationBucket` | 耗时桶 |
| `actorType` | 人类 / 系统 / agent / 噪音 |
| `actorRole` | 角色 |
| `actorUserId` | 可选，仅短期保留 |
| `uiSurface` | 页面来源 |
| `uiAction` | 动作来源 |
| `clientVisitId` | 匿名 visit id |
| `queryShapeJson` | 白名单参数形状 |

建议索引：

1. `occurredAt`
2. `routeKey + occurredAt`
3. `actorType + occurredAt`
4. `uiSurface + occurredAt`

### 5.2 小时聚合表：`ApiUsageHourlyStat`

用途：

1. 作为后台主要查询表。
2. 30 天、90 天趋势都基于它聚合。

建议维度：

1. `bucketStart`
2. `routeKey`
3. `method`
4. `actorType`
5. `actorRole`
6. `uiSurface`
7. `uiAction`

建议指标：

1. `requestCount`
2. `successCount`
3. `clientErrorCount`
4. `serverErrorCount`
5. `uniqueUserCount`
6. `uniqueVisitCount`
7. `lt100msCount`
8. `ms100To300Count`
9. `ms300To1000Count`
10. `s1To3Count`
11. `gt3sCount`

第一版不必追求精确 P95，只做耗时桶即可，足够支持 UI 优化判断。

### 5.3 路由目录表：`ApiRouteCatalog`

这是一个很有价值的辅助表，建议保留。

用途：

1. 给 route 贴业务标签。
2. 标记该 route 是否应被用户直接感知。
3. 记录预期 UI 入口，方便做“能力已存在但入口弱”的对照分析。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `routeKey` | 路由模板，唯一 |
| `featureArea` | `orders` / `crm` / `finance` / `projects` 等 |
| `routeClass` | `LIST` / `DETAIL` / `MUTATION` / `AUXILIARY` / `AI` |
| `expectedUiSurface` | 预期主要入口页面 |
| `shouldBeUserFacing` | 是否期望被用户直接触达 |
| `notes` | 产品备注 |

这个表不是日志，而是产品字典。

---

## 六、采集链路设计

### 6.1 采集触发点

建议把采集挂在 API route 的统一入口附近，而不是散落在每个业务函数内部。

原因：

1. 目标是统计“API 使用情况”，天然靠近 route 层。
2. 这样能覆盖绝大多数业务接口，避免各模块重复埋点。
3. 后续排除规则、归一路由、耗时统计都更统一。

### 6.2 前端补充头信息

如果只在后端看请求，很难知道请求来自哪个页面和哪个动作。

因此建议前端请求层统一附带两个轻量 header：

1. `x-scim-ui-surface`
2. `x-scim-ui-action`

例如：

1. 页面初次加载订单列表：`orders.list` + `page_load`
2. 切换筛选器：`orders.list` + `filter_change`
3. 在订单详情页绑定项目：`orders.detail` + `bind_project`

这样才能把“同一个 API 被不同 UI 场景调用”的差异看出来。

### 6.3 角色识别

后端基于现有 session 即可识别：

1. `ADMIN`
2. `USER`
3. `REPRESENTATIVE`
4. 未登录时为 `ANON`

但后台报表默认应只看已登录用户；未登录量更多用于安全和公开入口分析，不应干扰产品判断。

### 6.4 人类 / agent / 系统识别

建议规则如下：

1. 命中内部 token 或内部 cron 路由，标记为 `SYSTEM_INTERNAL`
2. 命中 `/api/agent/**` 或带 agent runtime 内部头，标记为 `AGENT_RUNTIME`
3. 命中框架性高频接口，标记为 `FRAMEWORK_NOISE`
4. 其余由浏览器登录态发起的业务请求，标记为 `HUMAN_UI`

这一步必须在采集层做，不要留给报表层临时猜。

### 6.5 写入策略

建议采用“主请求成功与否不依赖 telemetry 写入成功”的 best-effort 策略。

即：

1. 业务 API 优先返回。
2. telemetry 写入失败只记服务端错误日志，不影响主业务结果。

否则一个分析功能会反向污染核心业务稳定性。

### 6.6 聚合策略

建议定时任务按小时 rollup：

1. 从 `ApiUsageEvent` 聚合到 `ApiUsageHourlyStat`
2. 聚合完成后保留原始事件 7 到 14 天
3. 超出保留期的原始事件自动清理

这样可以兼顾灵活性与存储控制。

---

## 七、后台页面设计

建议增加一组 ADMIN 专用页面。

### 7.1 页面入口

建议路径：

1. `/admin/api-usage`
2. `/admin/api-usage/routes/[routeKey]`

在管理后台侧边栏中命名为：

1. `API 使用分析`

### 7.2 总览页信息

总览页建议包含以下模块：

1. 近 7 天总请求量
2. 近 7 天活跃 route 数
3. 人类 UI 请求占比
4. Top 20 高频 route
5. Top 20 高频 mutation route
6. Top 20 低使用但应面向用户的 route
7. 角色分布
8. 页面来源分布
9. 错误率异常 route

### 7.3 Top 高频表

建议字段：

1. `routeKey`
2. `featureArea`
3. `requestCount`
4. `uniqueUserCount`
5. `uniqueVisitCount`
6. `avg requests / visit`
7. `main uiSurface`
8. `successRate`

其中 `avg requests / visit` 很关键。

如果某 route 的人均访问请求数异常高，往往说明：

1. 切 tab 重拉太频繁。
2. 筛选器没有 debounce。
3. 同页多个组件重复请求同一数据。
4. 详情页初始化链路过长。

### 7.4 低使用能力表

建议重点列出：

1. `shouldBeUserFacing = true`
2. 但近 30 天请求量极低
3. 或只来自单一深层页面

这类接口是 UI 优化的重点候选：

1. 功能可能隐藏太深。
2. 命名可能不符合用户认知。
3. 入口可能只在详情页某个次级 tab 内。
4. 功能可能已经没有业务价值，可考虑下线。

### 7.5 Route 详情页

单个 route 详情页建议展示：

1. 7/30/90 天趋势
2. 按角色分布
3. 按 `uiSurface` 分布
4. 按 `uiAction` 分布
5. 成功率 / 4xx / 5xx
6. 耗时桶分布
7. 相关页面入口说明
8. 最近一次明显增长或下降的时间点

如果某 route 在多个页面被复用，这个页面能直观看出“真正的主入口”。

---

## 八、可直接支持的产品判断

这个后台建好后，可以支持以下高价值判断。

### 8.1 判断某能力是否值得补 UI 入口

如果某 API：

1. 业务价值高，
2. `shouldBeUserFacing = true`，
3. 但近 30 天几乎无调用，

则优先检查：

1. 是否根本没有前端入口。
2. 是否只有深层入口。
3. 是否文案让用户不理解。

### 8.2 判断某页面是否存在过度请求

如果某页面来源下的某 route：

1. `uniqueVisitCount` 不高，
2. 但 `requestCount` 很高，

则说明页面可能有：

1. 重复拉取。
2. 缺少缓存命中。
3. 组件拆分导致多次请求同源数据。
4. 某个筛选器或输入框触发过于频繁。

### 8.3 判断不同角色的工作流差异

例如：

1. `REPRESENTATIVE` 主要集中在 CRM 和客户相关读写。
2. `ADMIN` 主要集中在订单、财务和机构审核。
3. `USER` 是否几乎不触达某些关键能力。

这可以直接指导：

1. 角色化导航。
2. 首页卡片排序。
3. 移动端底部导航调整。

### 8.4 判断 AI / 快捷功能 adoption

例如：

1. `/api/projects/[id]/invoice-draft`
2. `/api/plugins/form-draft/run`
3. `/api/organizations/ai-draft`

这些接口的使用率，可以直接衡量：

1. AI 入口是否足够显眼。
2. 用户是否信任自动填写。
3. 某些辅助能力是否被“埋在流程里但没人点”。

---

## 九、隐私与安全边界

### 9.1 不采集的内容

明确禁止采集：

1. 请求 body
2. 响应 body
3. 搜索框原文
4. 聊天内容
5. 语音转写内容
6. 客户姓名、电话、邮箱、地址等自由文本
7. 上传文件名和附件内容

### 9.2 用户标识策略

第一版建议：

1. 原始事件表中允许短期保存 `actorUserId`
2. 聚合表只保存聚合后的 `uniqueUserCount`
3. 后台页面默认不暴露逐用户明细

这样既能支持角色分析，也不把产品后台变成行为监控工具。

### 9.3 权限

该后台仅 `ADMIN` 可见。

不建议向普通 `USER` 或 `REPRESENTATIVE` 开放，因为它属于内部产品治理工具，不是业务功能。

### 9.4 保留期

建议：

1. 原始事件：保留 7 到 14 天
2. 小时聚合：保留 180 到 365 天

这足够支持趋势分析，也能控制 SQLite 体量。

---

## 十、与现有系统的关系

### 10.1 不复用 `ActivityLog`

不建议把 API 使用采集直接写进现有 `ActivityLog`，原因：

1. `ActivityLog` 是项目级业务活动日志，不是全局 API telemetry。
2. `ActivityLog` 结构过于自由文本化，不适合高频聚合分析。
3. 大量查询型请求写入后会污染业务日志语义。

### 10.2 不复用 `AgentActionLog`

`AgentActionLog` 是 agent 审计日志，应继续专注于：

1. 谁发起了 agent 动作
2. 执行了什么 action
3. proposal / confirm / reject 是否成功

它不是“用户 UI API 使用分析”的替代品。

### 10.3 与 React Query 指标的关系

如果未来需要更细的前端性能诊断，可以再补充 React Query 级别统计。

但第一版不建议从前端缓存库切入。先把后端 route 维度跑通，收益更直接，也更稳。

---

## 十一、推荐分期

### Phase 1：后端 route 频率统计

目标：

1. 只统计 routeKey + method + role + actorType + 时间桶
2. 先做总览页 Top 高频 / Top 低使用

这一阶段已经可以支撑第一次 UI 入口优化。

### Phase 2：补充 `uiSurface` / `uiAction`

目标：

1. 前端请求层统一透传页面来源和动作来源
2. 支持页面级分析和重复请求分析

这一阶段才真正能回答“为什么这个 API 高 / 低频”。

### Phase 3：route catalog + 产品治理闭环

目标：

1. 为 route 建立 featureArea / routeClass / shouldBeUserFacing 元数据
2. 每次前端改版前后对照查看变化
3. 把它纳入长期产品优化流程

---

## 十二、验收口径

该方案落地后，至少应满足以下验收标准：

1. ADMIN 能在后台看到近 7 天 API 高频榜。
2. 报表默认能排除 `/api/auth/**`、`/api/internal/**`、`/api/agent/**` 等噪音。
3. 同一资源不同 ID 的请求会正确归并到同一 `routeKey`。
4. 能按角色查看调用差异。
5. 能识别某 route 的主要 `uiSurface`。
6. 能看出某页面下是否存在异常重复请求。
7. 不暴露请求正文、搜索词、聊天内容等敏感数据。

---

## 十三、建议的第一批重点观察对象

如果后续实施，建议优先观察以下类别：

1. 订单核心路径：`/api/orders`、`/api/orders/[id]`、`/api/orders/[id]/project-links`
2. CRM 列表与详情：`/api/crm/profiles`、`/api/crm/profiles/[id]`
3. 财务工作台：`/api/finance/order-invoices`、`/api/finance/costs`
4. AI / 草稿能力：`/api/plugins/form-draft/run`、`/api/projects/[id]/invoice-draft`、`/api/organizations/ai-draft`
5. 低频但潜在高价值动作：批量操作、合并、绑定、自动填充

这些最容易直接反映：

1. 入口是否合理。
2. 页面是否过度请求。
3. AI / 快捷能力是否真的被采用。

---

## 结论

这个“API 使用习惯采集后台”本质上不是为了做技术监控，而是为了让产品和前端优化从“感觉”变成“有证据的迭代”。

建议第一版把重点放在三件事：

1. 路由模板归一化。
2. 区分人类 UI 与系统噪音。
3. 补齐 `uiSurface` / `uiAction`，把请求和具体页面动作关联起来。

只要这三件事做对，后续无论是优化侧边栏导航、列表页筛选器、详情页 Tabs，还是评估 AI 入口是否应该前置，都会有足够清晰的数据依据。
