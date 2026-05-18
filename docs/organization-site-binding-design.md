# 单位主数据院区级绑定设计方案

## 背景

当前系统的单位主数据已经具备“单位 + 院区/校区”两级结构：

- `Organization` 表示单位主实体
- `OrganizationSite` 表示单位下的院区/校区/分支，已存在独立 `id`
- `Customer` 已支持同时绑定 `organizationId` 与 `organizationSiteId`

但代表绑定目前仍停留在单位级：

- `RepresentativeOrganization` 仅支持绑定到 `organizationId`
- 自动分配客户按整个单位执行
- CRM 归属校验按整个单位执行
- 管理 UI 只能给单位分配代表，无法精确到院区

这会导致以下问题：

1. 不同分院区由不同代表负责时，现有模型粒度不足。
2. 客户已经能绑定院区，但代表不能绑定院区，组织结构粒度不一致。
3. 单位内多院区共存时，客户自动归属与代表权限容易分错。

本方案目标是将代表绑定升级为“单位级 + 院区级”双层模型，并保留现有单位级兼容能力。

---

## 目标

### 业务目标

1. 允许代表绑定到整个单位。
2. 允许代表绑定到单位下某个院区/校区/分支。
3. 客户继续支持绑定单位和院区。
4. 支持“一个单位多个代表”，同时支持单位级主代表与院区级主代表。
5. 院区级绑定优先于单位级绑定。

### 非目标

1. 本期不引入三级及以上组织树权限。
2. 本期不做“自动从地址智能推断院区归属”。
3. 本期不改动订单、项目、发票等业务对象的单位引用结构。

---

## 现状

### 已有基础

1. `OrganizationSite` 已有独立主键，可直接作为“分院区子 id”使用，无需新增一套 site code。
2. `Customer` 已具备 `organizationSiteId` 字段，客户绑定院区能力已存在。
3. 单位解析、客户录入、客户申请、客户池筛选等流程已具备院区维度支持。

### 当前主要缺口

1. `RepresentativeOrganization` 没有 `organizationSiteId`。
2. 代表绑定审批、查询、冲突校验都只按单位级处理。
3. 自动分配客户 `autoAssignOrgCustomersToRep()` 只按 `organizationId` 扫描。
4. 单位管理页面、代表详情页、绑定审核页都不支持“绑定到院区”。
5. 单位合并时不会处理代表绑定与院区级绑定迁移。

---

## 设计原则

1. 兼容现有单位级绑定。
2. 院区级绑定只在需要时使用，不强迫所有单位都维护院区。
3. 权限与自动分配采用“更精确的绑定优先”原则。
4. 错误绑定采用归档，不做物理删除，保留审计链。
5. UI 上尽量复用现有单位/院区选择能力，避免新造交互体系。

---

## 数据模型设计

### 一、代表绑定模型升级

现有：

- `RepresentativeOrganization`
  - `representativeId`
  - `organizationId`
  - `status`
  - `source`
  - 审批字段

建议新增字段：

```prisma
model RepresentativeOrganization {
  id                 String   @id @default(cuid())
  representativeId   String
  organizationId     String?
  organizationSiteId String?
  isPrimary          Boolean  @default(false)
  ...
}
```

### 字段含义

1. `organizationId`
   - 必填业务语义
   - 表示所属单位

2. `organizationSiteId`
   - 可空
   - `null` 表示单位级绑定
   - 非空表示院区级绑定

3. `isPrimary`
   - 表示当前层级的主代表
   - 单位级主代表：`organizationId = X && organizationSiteId = null && isPrimary = true`
   - 院区级主代表：`organizationSiteId = Y && isPrimary = true`

### 约束建议

数据库层建议增加：

1. `@@index([organizationId, status])`
2. `@@index([organizationSiteId, status])`
3. `@@index([organizationId, organizationSiteId])`

唯一性建议：

1. 同一代表同一单位的单位级绑定最多一条
2. 同一代表同一院区绑定最多一条

由于 SQLite 对部分条件唯一索引支持有限，建议采用“两段式约束”：

1. 数据库保留基础唯一约束用于兜底
2. 服务端显式校验业务唯一性

推荐实现口径：

- 单位级绑定唯一：`representativeId + organizationId + organizationSiteId(null)` 业务唯一
- 院区级绑定唯一：`representativeId + organizationSiteId` 业务唯一

### 主代表约束

业务约束：

1. 一个单位最多一个单位级主代表
2. 一个院区最多一个院区级主代表
3. 单位与院区可同时各自拥有主代表，不冲突

实现方式：

1. 服务端事务更新时先清理同层级其他 `isPrimary=true`
2. 再把目标绑定设为 `isPrimary=true`

---

## 业务规则

### 一、绑定层级

绑定分两种：

1. 单位级绑定
   - 绑定到整个单位
   - 适用于单位整体由同一代表负责

2. 院区级绑定
   - 绑定到某个院区/校区/分支
   - 适用于不同院区归不同代表

### 二、客户归属判定

对于一个客户：

1. 若客户存在 `organizationSiteId`
   - 先查该院区的有效代表绑定
   - 若命中院区级绑定，则按院区级绑定处理
   - 若未命中，则回退到单位级绑定

2. 若客户不存在 `organizationSiteId`
   - 仅按单位级绑定处理

### 三、主代表规则

1. 单位级主代表只在单位级范围内生效。
2. 院区级主代表只在该院区范围内生效。
3. 院区级规则优先于单位级规则。
4. 若一个院区没有院区主代表，则允许回退参考单位级主代表。

### 四、冲突规则

1. 一个单位允许多个 `ACTIVE` 代表绑定。
2. 一个院区也允许多个 `ACTIVE` 代表绑定。
3. 但同一层级同一时刻只能有一个主代表。
4. 管理员可以归档错误绑定，也可以切换主代表。

---

## API 设计

### 一、代表绑定创建接口

接口：

- `POST /api/crm/representative-organizations`

新增请求字段：

```json
{
  "representativeId": "rep_xxx",
  "organizationId": "org_xxx",
  "organizationSiteId": "site_xxx",
  "canonicalName": "可选，保留现有申请逻辑"
}
```

规则：

1. 若传 `organizationSiteId`，则必须校验：
   - 该院区存在
   - 该院区属于 `organizationId`

2. 若只传 `organizationId`，视为单位级绑定。

3. 自动审批逻辑保持现状：
   - ADMIN 可直接生效
   - 区域经理按现有规则
   - 代表自行申请仍可走审批流

4. 默认主代表策略：
   - 若目标层级当前没有任何 `ACTIVE` 绑定，则新绑定自动 `isPrimary=true`
   - 否则默认 `isPrimary=false`

### 二、代表绑定更新接口

接口：

- `PATCH /api/crm/representative-organizations/[id]`

新增动作：

1. `approve`
2. `reject`
3. `archive`
4. `reactivate`
5. `set-primary`

请求示例：

```json
{
  "action": "set-primary"
}
```

行为定义：

1. `archive`
   - 将状态改为 `ARCHIVED`
   - 若当前为主代表，则清掉 `isPrimary`

2. `reactivate`
   - 将状态改回 `ACTIVE`
   - 默认不自动恢复主代表

3. `set-primary`
   - 仅允许对 `ACTIVE` 绑定执行
   - 在同层级内清除其他主代表
   - 当前绑定设为 `isPrimary=true`

### 三、代表绑定查询接口

接口：

- `GET /api/crm/representative-organizations`

返回结构建议增加：

```json
{
  "bindings": [
    {
      "id": "bind_xxx",
      "status": "ACTIVE",
      "isPrimary": true,
      "organizationId": "org_xxx",
      "organizationSiteId": "site_xxx",
      "organization": {
        "id": "org_xxx",
        "canonicalName": "某医院"
      },
      "organizationSite": {
        "id": "site_xxx",
        "siteName": "东院区",
        "siteType": "CAMPUS"
      },
      "representative": {
        "id": "rep_xxx",
        "name": "张三"
      }
    }
  ]
}
```

### 四、单位合并接口

接口：

- `POST /api/organizations/[id]/merge`

新增行为：

1. 同步迁移单位级绑定
2. 同步迁移院区级绑定
3. 若源院区与目标院区合并后发生 site 冲突，绑定的 `organizationSiteId` 也要重定向
4. 若合并后出现同一层级多个主代表：
   - 优先保留目标单位原主代表
   - 其余主标记清空

---

## 自动分配与权限规则

### 一、自动分配客户

现状：

- `autoAssignOrgCustomersToRep(organizationId, representativeEmail, assignerUserId)`

建议升级为：

```ts
autoAssignOrgCustomersToRepBinding({
  organizationId,
  organizationSiteId,
  representativeEmail,
  assignerUserId,
})
```

行为：

1. 若是院区级绑定
   - 仅分配 `organizationSiteId = 当前院区` 的客户

2. 若是单位级绑定
   - 分配该单位下未被院区级专属规则覆盖的客户
   - 最保守一期方案可先分配：
     - `organizationId = 当前单位`
     - 且 `organizationSiteId is null`
   - 二期再扩展到“未命中院区级绑定的客户”

### 二、客户 ownership 校验

现状：

- `checkOrgOwnership()` 只看 `organizationId`

建议改为：

1. 若提交对象带 `organizationSiteId`
   - 优先检查该代表是否拥有该院区的 `ACTIVE` 绑定
   - 若没有，再检查是否拥有该单位的单位级 `ACTIVE` 绑定

2. 若仅有 `organizationId`
   - 仍按单位级绑定判断

### 三、CRM 访问规则

本期建议不直接把“是否能看某客户”改成完全由绑定驱动，避免影响过大。

建议分两阶段：

1. 第一阶段
   - 绑定仅影响自动分配、申请校验、UI 呈现
   - 不直接重写 CRM 全量权限模型

2. 第二阶段
   - 在 CRM 查询中引入院区级作用域辅助筛选

---

## UI 设计

### 一、单位管理页

页面：

- `/admin/organizations`

调整内容：

1. 单位卡片展示：
   - 单位级代表绑定
   - 院区级代表绑定摘要

2. “分配代表”弹窗升级为两步选择：
   - 先选代表
   - 再选绑定范围：
     - 整个单位
     - 某个院区

3. 当前绑定列表支持操作：
   - 设为主代表
   - 归档
   - 恢复

### 二、代表详情页

页面：

- `/crm/representatives/[representativeId]`

调整内容：

1. 绑定列表按“单位级 / 院区级”分组
2. 展示主代表标识
3. 支持新增院区级绑定
4. 支持归档、恢复、设主代表

### 三、绑定审核页

页面：

- `/admin/representative-organizations`

调整内容：

1. 审核记录展示绑定层级：
   - 单位级
   - 院区级

2. 若是院区级申请，显示：
   - 单位名称
   - 院区名称

### 四、客户编辑与申请页

现有客户侧已有院区选择，不需要重做结构。

建议补充：

1. 若所选院区存在院区主代表，UI 上可提示“将优先归属给该院区代表”
2. 若只选单位未选院区，则提示“将按单位级规则归属”

---

## 迁移方案

### 一、数据库迁移

新增字段：

1. `RepresentativeOrganization.organizationSiteId`
2. `RepresentativeOrganization.isPrimary`

初始回填：

1. 所有历史绑定 `organizationSiteId = null`
2. 所有历史绑定 `isPrimary = false`

主代表初始化建议：

1. 对每个单位，选最早创建的一条 `ACTIVE` 绑定设为单位级主代表
2. 若某单位没有 `ACTIVE` 绑定，则不设主代表

说明：

由于历史上允许一个单位多个 `ACTIVE` 代表绑定，本次迁移不能假设唯一，只能保守初始化。

### 二、数据兼容

旧逻辑兼容策略：

1. 未传 `organizationSiteId` 的旧请求继续视为单位级绑定
2. 旧页面若未升级，仍能读取单位级绑定，不会立刻报错

### 三、回滚策略

如需回滚：

1. 可忽略 `organizationSiteId` 与 `isPrimary`
2. 业务回退到纯单位级绑定
3. 不建议删除数据列，以免丢失院区绑定数据

---

## 实施阶段

### 第一阶段：模型与接口

1. Prisma schema 增加 `organizationSiteId`、`isPrimary`
2. 升级代表绑定创建、更新、查询接口
3. 升级自动分配与 ownership 校验

### 第二阶段：后台管理 UI

1. 单位管理页支持院区级绑定管理
2. 代表详情页支持院区级绑定管理
3. 审核页展示院区级信息

### 第三阶段：单位合并与细节补齐

1. 合并单位时迁移院区级绑定
2. 合并重名院区时重定向绑定
3. 优化主代表冲突处理

### 第四阶段：体验增强

1. 客户编辑页增加归属提示
2. CRM 列表增加按院区绑定辅助视图
3. 根据业务反馈再决定是否做更强的权限联动

---

## 风险与注意事项

### 一、自动分配范围风险

如果单位级绑定继续覆盖所有客户，而院区级绑定也能覆盖同单位客户，会出现归属争抢。

建议一期采用保守规则：

1. 院区级绑定只接管该院区客户
2. 单位级绑定只接管未选院区客户

这会更稳定，也更容易解释。

### 二、历史数据不完整

如果很多客户没有 `organizationSiteId`，即使业务上实际属于某院区，也只能落到单位级。

建议后续通过运营或数据清洗逐步补齐客户院区。

### 三、合并与归档边界

1. 归档院区前要检查是否存在 `ACTIVE` 院区级绑定
2. 合并单位前要检查院区映射关系
3. 删除或归档错误绑定时要同步处理 `isPrimary`

---

## 建议决策

建议采用以下明确业务口径：

1. `OrganizationSite.id` 直接作为分院区子 id 使用，不新增额外编码体系。
2. 代表绑定允许两层：
   - 单位级
   - 院区级
3. 单位允许多个代表，院区也允许多个代表。
4. 每个层级最多一个主代表。
5. 院区级规则优先，单位级规则兜底。
6. 一期自动分配采用保守策略：
   - 院区级绑定分配院区客户
   - 单位级绑定分配未选院区客户

这个方案对现有系统侵入可控，且能和当前客户院区绑定能力自然对齐。
