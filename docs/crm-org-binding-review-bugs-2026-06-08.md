# CRM 单位绑定复核 Bug 核实

日期：2026-06-08

范围：
- 地区经理收到“单位绑定申请”提醒后的移动端处理链路
- 代表申请“新机构绑定”后的管理员复核链路

结论：
- 两个问题都已在代码层面核实成立。
- 第一个问题更准确地说，是“地区经理被通知为审核人，但移动端入口设计导致审核操作不易到达”，不是后端权限缺失。
- 第二个问题是审核流能力缺口：当前只支持“绑定已有 / 新建机构 / 拒绝”，不支持“强制新建”或“直接合并到现有机构”。

## Bug 1：地区经理能收到提醒，但手机上难以完成“通过”

### 核实结果

成立。

### 代码证据

1. 地区经理确实会被纳入单位绑定申请的通知对象。

- `notifyBindingReviewers()` 会给区域经理发 `CRM_ORG_BINDING_REVIEW` 通知，并把链接指向代表详情页 `/crm/representatives/${representativeId}`：
  [src/lib/crm/supervisor.ts](/home/solarise/project-manage/src/lib/crm/supervisor.ts:261)

2. 通知路径和审核权限路径不是同一套筛选逻辑。

- 发通知时走 `resolveBindingRegionalManagers()`，明确按 `role: "REGIONAL_MANAGER"` 过滤：
  [src/lib/crm/supervisor.ts](/home/solarise/project-manage/src/lib/crm/supervisor.ts:161)
- 审核权限判断时走 `resolveBindingReviewers()`，这里不再按 `role` 过滤，而是按代表所属 manager 关系取 reviewer 集合：
  [src/lib/crm/supervisor.ts](/home/solarise/project-manage/src/lib/crm/supervisor.ts:126)

这意味着：
- “谁会收到通知”
- “谁会被 `PATCH` 视为 reviewer”

目前不是完全同一条规则，后续若要放开权限，需要先决定以哪条链路为准。

3. 地区经理在后端对“绑定审核”本身确实有权限，不是 API 一概拒绝。

- `PATCH /api/crm/representative-organizations/[id]` 通过 `canReviewBinding()` 判断审核权限。
- `canReviewBinding()` 对非 `ADMIN` 用户会走 `resolveBindingReviewers()`，因此区域经理在 reviewer 集合中时可以审批：
  [src/app/api/crm/representative-organizations/[id]/route.ts](/home/solarise/project-manage/src/app/api/crm/representative-organizations/[id]/route.ts:13)

4. 代表详情页确实给 `REGIONAL_MANAGER` 暴露了“绑定单位”页签。

- `canManageBindings = ADMIN || REGIONAL_MANAGER`
- 页签 `organizations` 只有满足该条件时才显示：
  [src/app/crm/representatives/[representativeId]/page.tsx](/home/solarise/project-manage/src/app/crm/representatives/[representativeId]/page.tsx:37)
  [src/app/crm/representatives/[representativeId]/page.tsx](/home/solarise/project-manage/src/app/crm/representatives/[representativeId]/page.tsx:115)

5. 真正的“通过/拒绝”按钮在 `RepresentativeOrganizationsTab` 内部，只会出现在 `PENDING` 绑定卡片上。

- 审核按钮位于卡片右侧：
  [src/components/crm/representative-organizations-tab.tsx](/home/solarise/project-manage/src/components/crm/representative-organizations-tab.tsx:234)

6. 但代表详情页的 Tabs 在移动端没有提供横向滚动或折行兜底。

- `TabsList` 是 `inline-flex w-fit`，不会自动换行；
- 代表详情页又把多个 Tab 横向排成一行；
- 在手机宽度下，后面的“绑定单位”Tab 很容易被挤出首屏视口：
  [src/components/ui/tabs.tsx](/home/solarise/project-manage/src/components/ui/tabs.tsx:26)
  [src/app/crm/representatives/[representativeId]/page.tsx](/home/solarise/project-manage/src/app/crm/representatives/[representativeId]/page.tsx:115)

### 根因判断

主因是移动端入口可达性问题：
- 通知把地区经理导到代表详情页；
- 审核操作被放在一个横向 Tab 里的次级内容区；
- 该 Tab 列表在手机上没有横向滚动/折行/更明显的入口；
- 用户实际感知就是“有提醒，但没有通过按钮”。

### 相关联的次级问题

即便地区经理进入了“绑定单位”Tab，遇到“新机构申请”时也不一定能闭环处理：
- 绑定审核弹窗会提示“前往单位审核”；
- 但这个链接指向 `/admin/organization-reviews`；
- 该页面、列表 API、PATCH API 当前都只允许 `ADMIN` 访问：
  [src/components/crm/representative-organizations-tab.tsx](/home/solarise/project-manage/src/components/crm/representative-organizations-tab.tsx:258)
  [src/app/admin/organization-reviews/page.tsx](/home/solarise/project-manage/src/app/admin/organization-reviews/page.tsx:79)
  [src/app/api/organization-reviews/route.ts](/home/solarise/project-manage/src/app/api/organization-reviews/route.ts:1)
  [src/app/api/organization-reviews/[id]/route.ts](/home/solarise/project-manage/src/app/api/organization-reviews/[id]/route.ts:17)
- 同时，绑定审核 API 在 `approve` 新机构绑定时，还会额外要求 `organizationReviewTask.status === "APPROVED"` 且 `suggestedOrganizationId` 非空，否则直接返回 `400`：
  [src/app/api/crm/representative-organizations/[id]/route.ts](/home/solarise/project-manage/src/app/api/crm/representative-organizations/[id]/route.ts:48)

这意味着：
- 地区经理可以审核“已有机构绑定”；
- 但对“需要先过主数据审核的新机构绑定”，当前并不能独立完成全流程；
- 即使地区经理能点到绑定审核里的“通过”，只要该绑定还没有完成机构主数据审核，API 也会挡回。

### 修复建议

1. 先修移动端入口可达性。
- 最小改动是给代表详情页 Tabs 增加横向滚动能力，建议同时补 `-webkit-overflow-scrolling: touch`。
- 或给“绑定单位”提供独立移动端入口。
- 更稳妥的做法是：通知直接深链到“绑定单位”视图，而不是只进代表详情默认 `overview`。

2. 把“地区经理可审的绑定审核”与“仅管理员可审的机构主数据审核”在 UI 上明确区分。
- 避免地区经理点进来后才发现自己没有能力完成后续动作。

3. 如果产品预期地区经理可闭环处理新机构绑定，则需要重新定义权限边界。
- 这是产品权限决策，不是单纯前端兼容性修补。
- 要么放开部分 `organization-reviews` 审核权限给地区经理；
- 要么在绑定审核页内直接提供受控的机构处理动作。

## Bug 2：新机构申请被驳回后，管理员无法“强制新建”或“直接合并”

### 核实结果

成立。

### 当前实际流程

1. 代表提交新机构绑定时，如果名称未精确解析到现有机构：
- 系统会创建 `OrganizationReviewTask`
- 同时创建 `RepresentativeOrganization(status=PENDING, organizationId=null)`
- 两者绑定在一起，等待审核：
  [src/app/api/crm/representative-organizations/route.ts](/home/solarise/project-manage/src/app/api/crm/representative-organizations/route.ts:211)

2. 管理员在“单位复核”页当前只有三种操作：
- `绑定已有`
- `新建机构`
- `拒绝`
  [src/app/admin/organization-reviews/page.tsx](/home/solarise/project-manage/src/app/admin/organization-reviews/page.tsx:233)

3. 但“新建机构”并不是强制新建。

- `approveAndCreate` 在后端会先按 `normalizedName` 查重；
- 一旦存在同 normalizedName 的机构，直接返回 `409 已存在同名机构`：
  [src/app/api/organization-reviews/[id]/route.ts](/home/solarise/project-manage/src/app/api/organization-reviews/[id]/route.ts:191)

4. 项目里其实已经有“机构合并”能力，但它挂在机构管理页，不在这条审核流里。

- 机构合并 API：
  [src/app/api/organizations/[id]/merge/route.ts](/home/solarise/project-manage/src/app/api/organizations/[id]/merge/route.ts:7)
- 机构管理页也有单独的 merge 操作：
  [src/app/admin/organizations/page.tsx](/home/solarise/project-manage/src/app/admin/organizations/page.tsx:269)
- 此外，项目里还有一套独立的 admin 绑定管理页 `/admin/representative-organizations`，当前也只承载“通过/拒绝”这类绑定层动作：
  [src/app/admin/representative-organizations/page.tsx](/home/solarise/project-manage/src/app/admin/representative-organizations/page.tsx:1)

### 根因判断

这是审核流建模不完整，不是单点校验错误。

当前审核流默认把机构复核理解成三选一：
- 绑定到已有机构
- 新建一个全新机构
- 拒绝

但真实业务还需要至少两种额外决策：
- 强制新建一个“先保留、后整理”的机构
- 把申请结果直接纳入“合并到现有机构”的路径

现在这两种能力都不在复核流里，所以当名称相近或同名时，管理员会被迫退回到“驳回”。

### 修复建议

1. 在机构复核页把管理员动作扩成至少四种。

- `绑定已有`
- `新建机构`
- `强制新建`
- `合并到现有机构`

2. 明确区分两类“新建”。

- `新建机构`：继续保留当前 normalizedName 去重保护。
- `强制新建`：允许管理员越过去重，但必须强制填写 `reviewNote`，并自动写入专门的审计语义。

3. 把“合并到现有机构”做成审核期内动作，而不是要求管理员先去别的页面建档再回来处理。

建议流程：
- 管理员在复核页选择目标机构；
- 默认应直接复用现有 `POST /api/organizations/[id]/merge` 能力，而不是重新实现一套 merge 逻辑。
- 更推荐的审核流内方案是不创建中间机构，直接把该 review task 解析到目标机构，并把 `rawInput` 沉淀成 alias。

4. 审核动作需要有清晰审计语义。

当前代码里已经存在：
- `DB_CANDIDATE`
- `MANUAL_NEW`

真正需要新增的是：
- `MANUAL_FORCE_NEW`
- `MANUAL_MERGED_TO_EXISTING`

这样后续才能区分：
- 是正常新建
- 是管理员强制保留重复实体
- 还是“原申请被吸收进已有机构”

5. 如果允许“强制新建后再合并”，要避免把它变成两步人工绕路。

更合理的是直接在同一审核上下文里完成，而不是要求管理员：
- 先在复核页失败
- 再跳机构管理页手工建档
- 再手工 merge
- 再回来处理绑定

6. 若扩展审核动作集，需要同步评估两套管理入口。

- `单位复核` 页是主数据审核入口；
- `/admin/representative-organizations` 是绑定审核入口；
- 如果审核期内新增“强制新建 / 合并到现有机构”，要明确是只放在 `organization-reviews`，还是两个管理页都要同步暴露一致动作。

## 建议优先级

P1：
- 修复代表详情页移动端 Tabs 可达性，确保地区经理能真正进入“绑定单位”审核区。
- 给通知增加更直接的审核入口。

P1：
- 扩展机构复核页的管理员动作集，补上“强制新建 / 合并到现有机构”。

P2：
- 重新梳理“地区经理是否应具备新机构主数据审核能力”。
- 如果不具备，UI 需明确提示“该申请需管理员完成机构主数据审核”。

## 本次审阅说明

本次仅做代码与流程核实，未落业务修复代码。
