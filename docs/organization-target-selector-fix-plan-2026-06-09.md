# 机构目标选择器 Fix Plan

日期：2026-06-09

范围：
- 机构管理页“合并机构”中的“目标机构”选择器
- 单位复核页“绑定已有机构 / 合并到现有机构”中的机构选择器

结论：
- 问题已在代码层面核实成立。
- 当前两个入口都使用“不可输入的 `Select` + 大列表枚举”模式，在机构数据量上来后会显著影响操作效率，并增加误选风险。
- 现有 `OrganizationSelect` 虽然具备搜索能力，但不能直接照搬到这两个 admin 场景；它当前的数据契约和交互语义还不够贴合“高风险管理动作”的要求。

## 问题描述

### 1. 合并机构的“目标机构”难以选择

成立。

- 机构管理页的 merge dialog 直接使用 `Select` 渲染目标机构列表，用户不能输入搜索，只能滚动查找：
  [src/app/admin/organizations/page.tsx](/home/solarise/project-manage/src/app/admin/organizations/page.tsx:959)
- 候选项来自页面初始化后拉取的全量机构数据：
  [src/app/admin/organizations/page.tsx](/home/solarise/project-manage/src/app/admin/organizations/page.tsx:93)
- 后端 `GET /api/organizations` 会返回所有未删除机构及其 alias/site/count 信息：
  [src/app/api/organizations/route.ts](/home/solarise/project-manage/src/app/api/organizations/route.ts:25)

这意味着：
- 机构越多，滚动选择越不可用；
- 合并是 destructive flow，误选目标机构的代价高；
- 当前选择器没有提供足够的检索与确认信息。

### 2. 单位复核中的“绑定到现有机构”同样难以选择

成立。

- 单位复核页的“绑定已有机构 / 合并到现有机构”弹窗同样使用 `Select`，只能从静态列表中滚动选择：
  [src/app/admin/organization-reviews/page.tsx](/home/solarise/project-manage/src/app/admin/organization-reviews/page.tsx:335)
- 其候选项同样来自页面层一次性拉取的 `/api/organizations` 全量结果：
  [src/app/admin/organization-reviews/page.tsx](/home/solarise/project-manage/src/app/admin/organization-reviews/page.tsx:103)

这条链路的风险比普通表单更高：
- “绑定已有机构”会决定复核任务最终落到哪个主数据实体；
- “合并到现有机构”还会把原始输入沉淀为 alias；
- 这里一旦误选，后续清理成本不低。

## 根因判断

主因不是没有组件，而是关键管理场景没有接入正确的选择器模式。

当前代码里已经有可搜索的 `OrganizationSelect`：
- 内置输入框、搜索结果列表、桌面 `Popover` 与移动端 `Sheet`：
  [src/components/organization-select.tsx](/home/solarise/project-manage/src/components/organization-select.tsx:341)
  [src/components/organization-select.tsx](/home/solarise/project-manage/src/components/organization-select.tsx:601)

但它不能直接无脑替换到上述两个场景，原因有三点：

1. 它的非代表分支依赖 `/api/organizations/list?search=...`：
   [src/components/organization-select.tsx](/home/solarise/project-manage/src/components/organization-select.tsx:368)

2. 该接口当前按角色分不同结果上限：
- 代表：`20` 条
- 非代表：`50` 条
  [src/app/api/organizations/list/route.ts](/home/solarise/project-manage/src/app/api/organizations/list/route.ts:54)

在 admin 场景里，真正相关的是“非代表默认也只有 `50` 条”这一点：
   [src/app/api/organizations/list/route.ts](/home/solarise/project-manage/src/app/api/organizations/list/route.ts:44)

3. 该组件当前默认语义更偏“普通业务表单选单位”：
- 支持“不选择单位”
- 支持快速新建单位
- 代表模式还混入了“申请绑定”语义

而 admin 的 merge / review 场景需要的是：
- 必须精确选中一个已存在机构
- 不应允许在此处快速新建
- 应支持排除 source org、自定义候选展示和更强确认信息

所以如果只是把 `Select` 换成现在的 `OrganizationSelect`，很可能会把问题从“完全不能搜”变成“能搜但搜不全 / 语义不对 / 容易误用”。

## 现状风险

### 可用性风险

- 机构列表长时，管理员只能靠滚动定位目标机构。
- 中文机构名通常前缀相似，肉眼扫列表效率低。
- 在手机或窄屏弹窗里，这个问题会更明显。

### 正确性风险

当前候选项与已选态展示信息偏少：
- 列表项主要是 `canonicalName (orgCode)`：
  [src/app/admin/organizations/page.tsx](/home/solarise/project-manage/src/app/admin/organizations/page.tsx:967)
  [src/app/admin/organization-reviews/page.tsx](/home/solarise/project-manage/src/app/admin/organization-reviews/page.tsx:342)
- 触发器选中后通常只剩机构名：
  [src/app/admin/organizations/page.tsx](/home/solarise/project-manage/src/app/admin/organizations/page.tsx:962)
  [src/app/admin/organization-reviews/page.tsx](/home/solarise/project-manage/src/app/admin/organization-reviews/page.tsx:338)

这不足以支撑高风险操作确认，尤其在以下情况下容易选错：
- 同名或近似名机构较多
- 用户更依赖地址、院区、orgCode 辅助判断
- 当前任务的 `rawInput` 与 canonicalName 存在差异

## 修复目标

P1 目标：
- 让管理员可以输入关键字搜索目标机构，而不是只能滚动查找。
- 候选结果必须可控、可解释，避免“搜到了但不完整”。
- merge / review 两个入口使用一致的 admin 选择器模式。

P1.5 目标：
- 在确认前展示足够的目标机构摘要，降低误选概率。
- 明确区分“从已有机构中选择”与“新建机构”两条链路，不在 destructive flow 中混入快速建档语义。

## 建议方案

### 方案 A：抽出 Admin 专用的可搜索机构选择器

建议不要直接把当前 `OrganizationSelect` 原样接过去，而是做一个更收紧的 admin 版本，或者给现有组件新增明确的 admin mode。

这个 admin 版本至少应支持：
- 可输入搜索
- debounce 请求
- 仅展示已存在机构
- 可传入 `excludeIds`
- 可关闭“不选择单位”
- 可关闭“快速新建单位”
- 可自定义候选项副信息展示

如果走“在现有 `OrganizationSelect` 上加 admin mode”路线，还需要评估 props 扩展成本。当前组件并没有这些外部可配能力：
- 没有 `excludeIds`
- 没有 `allowEmpty=false` 或 `required` 一类约束
- `hideQuickAdd` 只是内部按 `rep-discover` 模式硬编码控制，不能从 admin 页面直接传入

这意味着：
- 给现有组件补 admin mode 不是小修；
- 需要同步改 `OrganizationSelectProps` 和内部状态机；
- 要评估是否比单独抽一个轻量 admin 选择器更划算。

推荐使用场景：
- 机构管理页 merge dialog
- 单位复核页 bind / merge dialog

### 方案 B：补齐后端搜索契约，不再依赖全量机构列表

不建议继续沿用页面初始化时拉全量 `/api/organizations` 再塞给选择框。

更合适的契约应是：
- 打开选择器后按需搜索
- 搜索词为空时不返回海量列表，或只返回极少量上下文候选
- 搜索词输入后按名称 / orgCode / alias 检索
- admin 结果不要硬截断为当前 `50` 条且无提示

至少需要解决以下问题：

1. 搜索结果完整性
- 当前 `/api/organizations/list` 按角色使用 `take: userIsRep ? 20 : 50`：
  [src/app/api/organizations/list/route.ts](/home/solarise/project-manage/src/app/api/organizations/list/route.ts:54)
- 对 admin 管理动作来说，这个上限如果不带“更多结果/缩小关键词”语义，容易造成静默漏项。

2. 已选值回显
- 当已选机构不在当前搜索结果集时，触发器仍需稳定显示已选摘要。
- 否则会出现“选中了但重新打开后看不到”或“清空搜索后显示退化”的问题。

3. admin 搜索接口放置位置
- 需要明确是扩展现有 `/api/organizations/list` 的 admin 分支，还是单独提供 admin endpoint。
- 如果继续复用现有 endpoint，要避免把代表场景和 admin 场景的分页、空搜索、可见字段、提示语义绑死在一起。

4. alias 搜索覆盖
- 当前 `list` 接口已经支持 alias 命中：
  [src/app/api/organizations/list/route.ts](/home/solarise/project-manage/src/app/api/organizations/list/route.ts:36)
- 后续若拆 admin 专用接口，需确保这条能力被完整保留，不要回退成只按 canonicalName 搜索。

### 方案 C：提升候选项与确认态信息密度

候选项建议至少展示：
- canonicalName
- orgCode
- address（有则显示）
- site 数量或关键院区摘要

确认区建议展示：
- 当前操作对象
- 目标机构 canonicalName
- orgCode
- address
- merge 场景下可补一句“将迁移客户/别名/院区到该目标机构”

这样可以把“选择”和“确认”拆成两层校验，降低误合并概率。

### 方案 D：明确两个场景的差异化约束

虽然 merge dialog 和 review dialog 都要“选已有机构”，但仍有细微差别：

1. merge dialog
- 必须排除 source org 自己
- 只允许选未归档目标机构
- 确认文案应更强

2. review dialog
- 需要和当前 `rawInput`、建议候选、院区选择联动
- 选中机构后还可能继续选 site
- bind 与 merge 两个动作共用时，标题和副文案需继续保留区别

所以组件可以共用，但页面层不能完全无差别接入。

尤其是 review 场景里，admin 选择器更适合只负责“选机构”：
- 通过 `onSelect` 把完整候选结果回传给页面层
- 页面层再决定是否清空当前 site、是否展示院区选择器、是否保留 bind / merge 的差异文案

不建议把 site 逻辑也塞进机构选择器本体，否则组件职责会迅速膨胀。

## 不建议的修法

1. 仅给当前 `SelectContent` 加高度和滚动

这只能缓解“看不全”，不能解决“不能搜”的核心问题。

2. 直接复用当前 `OrganizationSelect` 默认行为

原因：
- 带“不选择单位”语义，不适合 destructive admin flow
- 带“快速添加单位”语义，容易把“选已有机构”与“新建机构”混在一起
- 结果集契约仍受 `/api/organizations/list` 当前上限影响

3. 继续使用页面层全量 `orgs.map(...)`

这会把性能、可用性和误选风险继续留在页面侧，不适合作为长期方案。

## 实施建议

### Phase 1

- 设计 admin 搜索选择器的数据契约
- 明确搜索接口的返回上限、结果提示和已选值回显策略
- 明确空搜索词行为：空列表、最近使用、还是上下文候选
- 明确网络失败时的降级策略：报错提示、重试、还是退回受限本地列表
- 明确 merge / review 两个入口共用哪些能力、各自保留哪些页面层约束

### Phase 2

- 先替换单位复核页 bind / merge dialog 的机构选择器
- 再替换机构管理页 merge dialog 的目标机构选择器
- 保留 site 选择逻辑不变，仅替换“机构主选择器”

这样更稳妥，因为 review 场景交互更复杂：
- 需要处理 `rawInput` 上下文
- 需要处理选中机构后的 site 联动
- 需要同时覆盖 bind / merge 两种动作

如果 admin 选择器能先在 review 场景跑通，merge dialog 的替换会更简单。

### Phase 3

- 回头审计仓库内其他类似“从大量机构中选一个现有机构”的 admin 场景
- 避免又出现新的不可搜索 `Select`

可用 grep 起点：

```bash
rg -n 'Select.*organization|选择机构|目标机构|绑定已有机构|合并到现有机构' src/app src/components
```

也建议补一组更偏实现形态的搜索：

```bash
rg -n 'SelectValue.*org|orgs\\.map\\(|organizations\\.map\\(' src/app src/components
```

### 回滚策略

- 初次替换时建议保留旧 `Select` 实现一小段时间，至少便于快速对照和回退。
- 如果上线后发现搜索结果契约、已选回显或 site 联动存在问题，应能快速退回旧实现，而不是把 merge / review 整个弹窗卡死在半改状态。
- 若后续改动面继续扩大，可考虑加一个临时 feature flag，但不必为了这一次替换先把 flag 体系做重。

## 验证清单

- 在机构数量较多时，管理员能通过输入关键词快速定位目标机构。
- 搜索关键字支持机构名、orgCode、alias 命中。
- 空搜索词行为符合预期，不会无提示拉出海量列表。
- merge dialog 中不会出现 source org 自己。
- review dialog 中选择机构后，site 联动仍正常。
- 已选机构在关闭/重新打开弹窗后能稳定回显。
- 搜索结果被截断时，UI 有明确提示，而不是静默漏项。
- 搜索请求失败时，用户能看到明确错误并可重试，不会直接落成空列表误判。
- 键盘交互可用：上下键选择、回车确认、Esc 关闭。
- 不存在“快速新建单位”误混入 merge / bind destructive flow 的情况。

## 本次说明

- 本文档仅记录问题核实与修复计划。
- 本轮未落代码。
