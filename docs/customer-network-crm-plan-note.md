# Note: 客户关系网络 CRM 分支规划

## 状态

本文档是规划 note，不是立即实施 spec。

目标是先把边界和演进方向定清楚，避免把当前项目管理系统里的 `Customer` 做得过重，后面又很难拆。

## 当前结论

客户关系网络这条线，建议作为**相对独立的 CRM 分支系统**来做，而不是继续往当前项目管理系统里的 `Customer` 主模型上叠功能。

结论如下：

1. 当前项目管理系统继续作为**客户主数据源**
2. CRM 分支系统负责**客户关系网、分组、归属、跟进状态、代表视角管理**
3. 两边通过接口同步，不共享“业务逻辑所有权”
4. 当前系统只在必要位置展示 CRM 返回的摘要信息
5. 不要把 `课题组负责人`、介绍关系、跟进状态、代表归属等 CRM 逻辑继续直接堆进当前 `Customer`

一句话：

`项目管理系统拥有客户主数据，CRM 系统拥有客户关系网络和客户经营状态`

## 为什么要这样拆

当前系统里的 `Customer` 已经承担了这些职责：

1. 项目绑定客户
2. 客户基础联系信息
3. 客户单位快照关联
4. 客户合并/归档/删除
5. 作为项目和客户管理页的基础数据源

如果继续把下面这些能力也塞进来：

1. 课题组树状结构
2. A 介绍 B、B 介绍 C 这类网状关系
3. 代表的客户经营状态
4. 跟进记录、下次联系时间、来源渠道
5. CRM owner / pipeline / 机会状态

那 `Customer` 很快会变成一个混合了：

1. 主数据
2. 业务快照
3. CRM 经营态
4. 图关系

的重模型。

这会带来几个问题：

1. 当前项目系统的接口会越来越难维护
2. 权限会越来越复杂
3. 代表侧 CRM 需求会不断反向污染项目主线
4. 后续想独立出 CRM 会很痛苦

所以这块应该尽早按 bounded context 拆开。

## 推荐架构

### 1. 所有权划分

#### 项目管理系统拥有

客户主数据字段：

1. `id`
2. `customerCode`
3. `name`
4. `principal`
5. `email`
6. `wechat`
7. `organization`
8. `address`
9. `miniProgramId`
10. `organizationId`
11. `organizationSiteId`
12. `archived / deleted / mergedIntoId`
13. `createdAt / updatedAt`

也就是说，当前系统继续负责：

1. 客户是谁
2. 客户怎么联系
3. 客户归属哪个基础单位
4. 客户是否已经合并/归档/删除

#### CRM 分支系统拥有

客户经营和关系网络字段：

1. 客户分组
2. 课题组负责人和成员关系
3. 客户介绍链路
4. 客户 owner（哪个代表在维护）
5. 跟进状态
6. 跟进记录
7. 下次跟进时间
8. 客户标签
9. 机会阶段
10. 关系图谱

也就是说，CRM 负责：

1. 客户之间是什么关系
2. 谁在负责经营这个客户
3. 当前客户处于什么跟进状态
4. 未来应该跟谁继续推进

### 2. 集成方向

推荐采用：

`项目管理系统 -> 提供客户主数据 -> CRM 同步镜像 -> CRM 维护关系网络 -> 项目管理系统按需读取 CRM 摘要`

而不是：

`两边同时写同一张 Customer 表`

## 不建议的方案

下面这些都不建议：

1. 直接在当前 `Customer` 上新增一堆 CRM 字段
2. 用 `principal` 文本字段硬编码树状关系
3. 在当前系统里直接做复杂 graph UI
4. 让项目系统同时负责“客户主数据”和“客户关系网络”
5. 让 CRM 反向直接写当前系统的 `Customer` 主数据

## Customer Owner 迁移策略

### 当前策略

当前**不要**把 `Customer owner` 从项目管理系统迁到 CRM。

当前默认策略保持为：

1. 项目管理系统继续 owning `Customer`
2. CRM 先作为“关系网络与经营增强系统”
3. 先建立同步接口和摘要接口
4. 等 CRM 稳定后，再评估是否迁移 owner

这是一个刻意保守的决定，不是临时妥协。

### 为什么现在不迁

如果现在就把 `Customer owner` 切到 CRM，会直接影响当前主线的这些能力：

1. 新建项目时的客户选择
2. 编辑项目时的客户绑定
3. 客户管理页
4. 客户合并 / 归档 / 删除
5. 项目列表和详情中的客户展示
6. 统计和筛选
7. 后续客户与单位的联动

而当前 CRM 还没有稳定运行，也还没有经过足够长时间的业务验证。

这时强行切 owner，风险主要有：

1. 主线项目管理被 CRM 牵连
2. 两边接口不断变化，回滚成本高
3. 权限和同步问题会同时爆发
4. 一旦 CRM 设计要改，当前主线也会被迫跟着改

一句话：

`现在迁 owner，收益不大，但会把主线耦合风险明显抬高`

### 推荐的阶段性路线

#### Phase A: 当前阶段

项目管理系统继续 owner，不改当前主链路。

CRM 只做增强层：

1. 客户分组
2. 课题组负责人关系
3. 介绍关系网络
4. owner / 跟进状态
5. 跟进记录

此时：

1. CRM 消费项目系统的客户主数据
2. 项目系统只读取 CRM 摘要
3. 项目系统不依赖 CRM 才能完成“新建项目”

#### Phase B: 接口预留阶段

在不迁 owner 的前提下，提前把未来迁移需要的接口留好。

建议预留：

1. 客户增量同步接口
2. 客户变更事件或 event log
3. CRM 摘要查询接口
4. 外部来源标识字段或映射位

重点是：

先把“以后能迁”的基础设施留好，而不是现在就切 owner。

#### Phase C: CRM 稳定验证阶段

只有当 CRM 在真实业务里稳定运行一段时间后，才进入 owner 迁移评估。

建议至少观察：

1. CRM 数据模型是否已经稳定
2. CRM 权限是否已经稳定
3. CRM 是否能承受代表日常使用
4. 同步链路是否可靠
5. 摘要接口是否满足当前系统展示需求

#### Phase D: Owner 迁移评估

只有在下面这些条件都满足时，才讨论把 `Customer owner` 迁到 CRM：

1. CRM 已经稳定跑了一段时间
2. 同步与回补机制已成熟
3. 当前系统对客户主数据的直接编辑已明显减少
4. CRM 的客户主数据编辑流已经成熟
5. 回滚方案已设计清楚

如果这些条件没有全部满足，就不要迁。

### 迁移前必须准备的能力

如果未来真的要迁 owner，必须先具备这些能力：

1. 项目系统具备 `CustomerMirror` 或等价镜像能力
2. CRM 能稳定提供客户主数据 API
3. 项目系统本地可缓存 / 同步 CRM 客户主数据
4. 项目系统在 CRM 不可用时仍可继续用本地镜像工作
5. 有明确的全量同步和增量同步方案

重点：

未来即便迁 owner，也不建议项目系统直接跨库读取 CRM 数据库。

更稳的方案仍然应该是：

`CRM owner + 项目系统本地镜像 + 同步更新`

### 当前就应该做的事

当前只建议做下面这些：

1. 保持项目系统继续 owning `Customer`
2. 先做 CRM 分支系统本身
3. 给 CRM 提供客户同步接口
4. 在项目系统里预留 CRM 摘要展示位置
5. 不新增强耦合

### 当前不要做的事

当前不建议做下面这些：

1. 不要现在把 `Customer` 改造成 mirror-only
2. 不要现在让新建项目依赖 CRM 在线返回
3. 不要现在把客户管理主入口迁走
4. 不要做项目系统和 CRM 的双写
5. 不要为了“以后可能迁”而重写现有主链路

### 当前推荐结论

当前最稳妥、最适合主线推进的策略是：

`项目管理系统继续 owning Customer`

`CRM 先做增强系统`

`接口先留，owner 后迁`

## 推荐的数据模型

下面是 CRM 分支系统建议拥有的模型，不建议直接加在当前系统里。

### 1. CustomerMirror

CRM 侧客户镜像，不是主数据 owner。

建议字段：

1. `id`
2. `sourceCustomerId`  对应项目系统里的 `Customer.id`
3. `customerCode`
4. `name`
5. `principal`
6. `email`
7. `wechat`
8. `organization`
9. `address`
10. `archived`
11. `deleted`
12. `mergedIntoSourceCustomerId`
13. `sourceUpdatedAt`
14. `syncedAt`

作用：

1. CRM 不直接依赖项目系统实时在线
2. CRM 可以基于镜像做搜索和图谱展示
3. 主数据同步失败时更容易排查

### 2. CustomerGroup

用于解决“课题组负责人 -> 课题组客户”这条线。

建议字段：

1. `id`
2. `name`
3. `leaderCustomerId`  可选，对应镜像客户
4. `ownerUserId`  当前维护人
5. `status`
6. `notes`
7. `archived`
8. `createdAt / updatedAt`

说明：

1. `课题组负责人` 不再只是一个文本字段
2. 课题组是一个显式实体
3. 同一个客户可以挂入一个或多个组，但建议先约束主组

### 3. CustomerGroupMember

用于组和客户的成员关系。

建议字段：

1. `id`
2. `groupId`
3. `customerId`
4. `role`
5. `isPrimary`
6. `joinedAt`
7. `notes`

建议角色：

1. `LEADER`
2. `MEMBER`
3. `CONTACT`
4. `COLLABORATOR`

### 4. CustomerRelation

用于网状关系，不要再用 group 结构硬扛。

建议字段：

1. `id`
2. `fromCustomerId`
3. `toCustomerId`
4. `type`
5. `strength`
6. `status`
7. `introducedAt`
8. `notes`
9. `createdByUserId`
10. `createdAt / updatedAt`

建议关系类型：

1. `REFERRED`  A 介绍 B
2. `COLLABORATES_WITH`
3. `REPORTS_TO`
4. `SAME_GROUP`
5. `SAME_LAB`
6. `OTHER`

重点：

1. `REFERRED` 是有方向的
2. `COLLABORATES_WITH` 这类关系可以在展示层视为双向
3. 不要试图只用树结构表达全部关系

### 5. CustomerCrmProfile

把 CRM 状态独立出来，不污染主数据。

建议字段：

1. `customerId`
2. `ownerUserId`
3. `stage`
4. `sourceChannel`
5. `importance`
6. `lastContactAt`
7. `nextFollowUpAt`
8. `summary`
9. `tagsJson`
10. `archived`

建议 stage：

1. `NEW`
2. `CONTACTED`
3. `FOLLOWING`
4. `ACTIVE`
5. `BLOCKED`
6. `LOST`
7. `DORMANT`

### 6. CustomerInteraction

CRM 跟进记录。

建议字段：

1. `id`
2. `customerId`
3. `type`
4. `happenedAt`
5. `summary`
6. `detail`
7. `createdByUserId`
8. `relatedProjectId` 可选
9. `nextActionAt` 可选

建议类型：

1. `CALL`
2. `WECHAT`
3. `EMAIL`
4. `MEETING`
5. `REFERRAL`
6. `NOTE`

## 关系表达建议

### 1. 树状结构怎么做

树状展示建议只用于：

1. `课题组 / 实验室 / 客户群`
2. `负责人 -> 成员`

也就是：

`CustomerGroup + CustomerGroupMember`

这是一条“组织/分组”关系，不是完整社交网络。

### 2. 网状结构怎么做

网状展示建议只用于：

1. 介绍关系
2. 合作关系
3. 同组/同单位弱关系

也就是：

`CustomerRelation`

### 3. 不要混在一起

建议把下面两种东西分开：

1. 组织结构
2. 业务关系

否则后面查询和展示会非常乱。

## 当前系统和 CRM 的接口边界

### 1. 当前系统对外提供

建议提供客户主数据同步接口：

1. `GET /api/crm-sync/customers`
2. 支持 `updatedAfter`
3. 返回客户基础字段 + 删除/归档/合并状态

也可以后续升级成 webhook：

1. 客户新增
2. 客户编辑
3. 客户合并
4. 客户归档
5. 客户删除

### 2. CRM 对当前系统提供

建议只返回摘要，不回写主数据。

可以提供：

1. `GET /api/crm-summary/customers/:sourceCustomerId`
2. `GET /api/crm-summary/customers/batch?ids=...`

返回摘要建议只包含：

1. `groupName`
2. `leaderName`
3. `ownerName`
4. `crmStage`
5. `relationCounts`
6. `nextFollowUpAt`
7. `lastInteractionAt`
8. `referralParentCount`
9. `referralChildCount`

当前项目系统只在必要页面展示这些摘要：

1. 客户详情页
2. 项目详情页客户卡片
3. 客户管理列表可选列

不要在当前系统里直接承载 CRM 编辑能力。

## 对 `principal` 的建议

当前系统里的 `principal` 仍然可以保留，但它的定位要降级为：

1. 兼容历史数据
2. 文本型辅助信息
3. CRM 初始化分组的 seed

不要把它继续升级成正式关系字段。

后续 CRM 初次导入时，可以按 `principal` 做一轮初始化：

1. 同名 `principal` 聚成一个组
2. 若 `Customer.name == principal`，可候选为组 leader
3. 无法确定 leader 时，先建组不设 leader

但这个初始化只能做一次辅助，不应该继续依赖它做正式关系维护。

## 实施阶段建议

### Phase 1: 分支系统最小闭环

目标：

1. CRM 能同步客户主数据
2. CRM 能做课题组分组
3. CRM 能做代表 owner 分配
4. CRM 能做跟进状态

本阶段不做图谱，只做列表和详情。

### Phase 2: 关系网络

目标：

1. 新增 `CustomerRelation`
2. 支持 `A -> B` 介绍链
3. 客户详情页显示“上游/下游介绍关系”
4. 提供基础关系搜索和列表

本阶段先做表格和关系面板，不急着做可视化 graph。

### Phase 3: CRM 经营能力

目标：

1. 跟进记录
2. 下次跟进时间
3. owner 工作台
4. 代表视角客户池

这一阶段才真正变成“代表可用的 CRM”。

### Phase 4: 图谱展示

目标：

1. 树状视图：课题组结构
2. 网状视图：介绍关系
3. 过滤器：时间、owner、stage、标签

注意：

graph 可视化必须放到后期，不要一上来就先做图。

## 权限建议

### 当前系统

当前系统继续保持现有客户权限逻辑，不为 CRM 让步。

### CRM 系统

建议：

1. `ADMIN` 可管理全部客户网络
2. `USER` 可管理全部或所属客户网络，按业务决定
3. `REPRESENTATIVE` 可维护自己 owner 下的 CRM 数据

但代表在 CRM 里能改的，建议只限：

1. 分组关系
2. 介绍关系
3. CRM 状态
4. 跟进记录
5. 下次跟进计划

不建议代表改：

1. 当前系统里的客户主数据主字段
2. 客户合并/删除
3. 客户基础唯一编码

## 技术建议

### 1. 数据库

如果 CRM 分支系统要认真做，建议优先考虑：

`独立 CRM 数据库（推荐 PostgreSQL）`

原因：

1. 关系边很多
2. 后续查询会复杂
3. graph / filter / owner / interaction 组合查询会越来越重
4. 不建议继续把这类网络结构压在当前 SQLite 主线里

### 2. 鉴权

推荐两种方案：

1. 共享用户体系，CRM 通过当前系统用户表/SSO 登录
2. CRM 维护本地用户映射，但用 email / userId 对齐

优先建议第一种。

### 3. 同步模式

推荐顺序：

1. 先做全量拉取 + `updatedAfter`
2. 稳定后再补 webhook

不要一上来就设计过重的双向同步。

## 给后续 agent 的指引

如果后续开始做这条线，默认遵循下面几条：

1. 不要继续往当前项目系统的 `Customer` 主模型里塞 CRM 字段
2. 当前系统只做客户主数据 owner
3. CRM 负责客户关系网、客户经营状态、跟进记录
4. `principal` 只保留为历史兼容字段，不再升级为正式关系模型
5. 树状结构和网状结构必须拆开建模
6. 当前系统只读取 CRM 摘要，不承载 CRM 主编辑流

## 当前推荐方向

最终推荐方向是：

`项目管理系统 = Customer 主数据源`

`CRM 分支系统 = Customer 关系网络与经营系统`

`两边通过同步接口和摘要接口连接，而不是共用一锅业务模型`
