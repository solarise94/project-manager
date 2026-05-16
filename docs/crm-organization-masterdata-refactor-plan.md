# CRM 机构主数据重构方案

## 背景

当前代表侧“客户信息编辑 / 客户申请 / 订单绑定客户时补建客户”这几条链路，对机构主数据的处理不一致，已经出现明显体验和治理问题：

1. 代表修改客户信息时，无法像内部用户一样选择已有机构。
2. 代表侧“新建机构”没有复用现有复核流，而是被简单降级成自由文本。
3. 客户主数据和机构主数据的创建、关联、复核入口分散，用户不知道什么时候应该补机构主数据。
4. 机构主数据相关逻辑散落在 `OrganizationSelect`、`/api/organizations/list`、`/api/organizations/quick-create`、`ensureOrganizationFromInput()`、`customer-application` 等多个入口，行为不一致。

本方案目标是把机构主数据逻辑收口成一条清晰链路：

- 代表可以搜索并选择已有机构
- 代表可以发起“新建机构申请”，由管理员复核
- 内部用户仍可直接创建机构
- 客户创建/编辑时，对“未匹配机构”给出明确提醒和补救动作

## 现状审查

### 1. 代表无法选择已有机构

- [src/components/organization-select.tsx](/home/solarise/project-manage/src/components/organization-select.tsx:216)
  对 `REPRESENTATIVE` 直接走纯 `Input`，完全绕开机构候选列表。
- [src/app/api/organizations/list/route.ts](/home/solarise/project-manage/src/app/api/organizations/list/route.ts:10)
  对 `REPRESENTATIVE` 直接 `403`。

这两个点叠加，导致代表在客户编辑时只能输入文本，不能绑定已有 `organizationId`。

### 2. 代表无法通过统一复核流申请新机构

- [src/app/api/organizations/quick-create/route.ts](/home/solarise/project-manage/src/app/api/organizations/quick-create/route.ts:10)
  对 `REPRESENTATIVE` 直接 `403`。
- [src/app/api/organization-reviews/intake/route.ts](/home/solarise/project-manage/src/app/api/organization-reviews/intake/route.ts:11)
  已经存在“机构建档申请”能力，但没有被 `OrganizationSelect`、客户编辑、客户申请等代表侧主流程接入。

结果是：

- 代表有“机构待复核”这套后端能力
- 但主要业务界面并不真正使用它

### 3. 自动创建机构逻辑与代表侧复核逻辑冲突

- [src/lib/organizations/ensure-organization.ts](/home/solarise/project-manage/src/lib/organizations/ensure-organization.ts:14)
  在无匹配时直接创建 `Organization`
- [src/app/api/customers/route.ts](/home/solarise/project-manage/src/app/api/customers/route.ts:117)
  `autoCreateOrganization` 也会走这条逻辑

这条逻辑适合内部导入、后台快捷创建，不适合代表侧。

### 4. 现有客户申请页已经做了一半“待确认”机制

- [src/components/crm/customer-application-form-dialog.tsx](/home/solarise/project-manage/src/components/crm/customer-application-form-dialog.tsx:124)
  对机构输入会走 `resolveOrganization`
- 非精确匹配时保留 `organizationRawInput`，并显示“待确认”

这套思路是对的，但目前：

- 代表仍不能真正搜已有机构
- “新建机构申请”没有直接按钮
- 提醒文案不够强，不形成完整闭环

## 目标

### 业务目标

1. 代表在修改客户信息时可以绑定已有机构。
2. 代表在没有匹配机构时，可以直接发起“新建机构申请”。
3. 代表在新建客户/申请客户时，如果机构未匹配，系统明确提醒“建议同时申请机构主数据”。
4. 内部用户保持当前效率，不受复核流影响。

### 工程目标

1. 机构选择、机构新建、机构复核统一走一套服务边界。
2. 避免再出现：
   - 某页面能选机构，另一页面只能输文本
   - 某入口直接建库，另一入口走复核
3. 尽量复用现有：
   - `OrganizationReviewTask`
   - `/api/organization-reviews/intake`
   - `resolveOrganization()`
   - 管理端机构复核页

## 非目标

本轮不做以下事项：

1. 不重做整个机构复核后台。
2. 不改 `OrganizationReviewTask` 主模型结构，除非补充少量可选字段。
3. 不开放代表直接创建正式 `Organization`。
4. 不引入新的异步 job 系统。

## 总体方案

核心思路：

1. 把 `OrganizationSelect` 从“按角色硬编码”改成“按能力配置”。
2. 代表允许“搜索已有机构”，但不允许“无审核直建正式机构”。
3. 代表侧“新建机构”统一改为“发起机构申请”。
4. 客户编辑、客户申请、客户快捷创建等入口统一接这个选择器和提醒逻辑。

## 权限口径

### 机构搜索

- `ADMIN` / `USER`
  - 可搜索已有机构
  - 可浏览空搜索结果（例如前 50 条）
- `REPRESENTATIVE`
  - 可搜索已有机构
  - 不能空搜索浏览全库
  - 必须输入关键词后才返回候选
  - 建议限制：
    - `search.trim().length >= 2`
    - `take <= 10`
- `REGIONAL_MANAGER`
  - 按内部用户处理，允许搜索已有机构

### 机构新建

- `ADMIN` / `USER`
  - 保持当前“快速创建正式机构”
- `REPRESENTATIVE`
  - 不创建正式机构
  - 改为创建 `OrganizationReviewTask`
  - 状态为 `PENDING`

## 具体改造

### Phase 1：收口机构选择器能力模型

#### 目标

把 `OrganizationSelect` 从角色驱动改成能力驱动。

#### 现状

- 组件内部直接判断 `isRep`
- 代表分支直接退化成普通 `Input`

#### 改造方案

修改：

- [src/components/organization-select.tsx](/home/solarise/project-manage/src/components/organization-select.tsx)

新增 props：

```ts
interface OrganizationSelectProps {
  value: string;
  displayValue?: string;
  disabled?: boolean;
  mode?: "internal" | "representative";
  allowRequestCreate?: boolean;
  requestCreateLabel?: string;
  onRequestCreate?: (rawName: string) => Promise<void> | void;
  onChange: (id: string | null, canonicalName: string, address?: string | null, taxId?: string | null) => void;
}
```

行为：

- `internal`
  - 桌面/移动端维持现有候选选择器
  - 底部 CTA 为“快速添加单位”
- `representative`
  - 也使用候选选择器
  - 但列表数据来自受限搜索
  - 底部 CTA 改为“申请新建机构”

#### 注意

不要继续用“代表 = 纯文本输入”这条分支。那是这轮最核心的问题源头。

---

### Phase 2：开放代表侧机构搜索，但限制枚举能力

#### 目标

让代表能选已有机构，但避免全量枚举机构主数据。

#### 改造文件

- [src/app/api/organizations/list/route.ts](/home/solarise/project-manage/src/app/api/organizations/list/route.ts)

#### 改造方案

当前：

- `REPRESENTATIVE` 直接 `403`

改为：

- `ADMIN` / `USER` / `REGIONAL_MANAGER`
  - 保持当前行为
- `REPRESENTATIVE`
  - 允许访问
  - 但要求：
    - `search` 必填
    - `search.length >= 2`
    - `take = 10`
  - 只返回最小字段集：
    - `id`
    - `orgCode`
    - `canonicalName`
    - `address`
    - `taxId`

#### 建议规则

```ts
if (isRepresentative(role)) {
  if (!search || search.length < 2) {
    return NextResponse.json({ organizations: [] });
  }
  take = 10;
}
```

这样能满足代表选择已有机构，同时不会把全库机构暴露成可浏览列表。

---

### Phase 3：统一“代表新建机构”到机构复核流

#### 目标

把代表侧的“快速添加单位”改成“申请新建机构”，复用 `OrganizationReviewTask`。

#### 优先方案

直接复用：

- [src/app/api/organization-reviews/intake/route.ts](/home/solarise/project-manage/src/app/api/organization-reviews/intake/route.ts)

但需要补两点：

1. `sourceType` 不要只写死 `ORG_CREATE_REQUEST`
2. 支持从不同业务上下文调用，例如：
   - `CUSTOMER_EDIT`
   - `CUSTOMER_APPLICATION`
   - `CUSTOMER_CREATE`

#### 建议改法

扩展 intake API 请求体：

```ts
{
  query: string;
  sourceType?: "ORG_CREATE_REQUEST" | "CUSTOMER_EDIT" | "CUSTOMER_APPLICATION" | "CUSTOMER_CREATE";
  sourceId?: string;
}
```

存储规则：

- `rawInput` = 用户输入机构名
- `normalizedInput` = 标准化名称
- `sourceType` = 来源页面
- `sourceId` = 客户 ID / 客户申请 ID / 当前用户 ID
- `createdById` = session.user.id

#### 前端行为

在 `OrganizationSelect(mode="representative")` 中：

- 当用户输入文本且没有选择现有机构时
- 点击底部 CTA：
  - 调 `POST /api/organization-reviews/intake`
  - 成功后：
    - 保留 `displayValue`
    - 不写 `organizationId`
    - 写 `organizationRawInput`
    - 显示 “机构申请已提交，待管理员复核”

---

### Phase 4：客户编辑页支持“选已有机构 + 申请新机构”

#### 目标

让代表在编辑自己负责客户时，不再只能输入自由文本。

#### 改造文件

- [src/components/crm/customer-edit-dialog.tsx](/home/solarise/project-manage/src/components/crm/customer-edit-dialog.tsx)
- [src/app/api/customers/[id]/route.ts](/home/solarise/project-manage/src/app/api/customers/[id]/route.ts)

#### 前端改造

在代表侧编辑客户时：

- `OrganizationSelect` 使用 `mode="representative"`
- 支持：
  - 搜索并选择已有机构
  - 申请新机构

新增本地状态：

```ts
const [orgReviewPending, setOrgReviewPending] = useState(false);
```

当代表发起新机构申请后：

- 表单保留：
  - `organization = rawInput`
  - `organizationId = ""`
  - `organizationRawInput = rawInput`
- UI 显示 badge：
  - `机构待复核`

#### 后端改造

`PATCH /api/customers/[id]` 当前已经允许代表修改客户主数据。这里补规则：

- 若 `organizationId` 有值：
  - 走正式机构校验
- 若 `organizationId` 为空但 `organizationRawInput` 有值：
  - 允许保存原始文本
  - 不自动创建正式机构

也就是说：

- 代表可以把客户主数据改成“待复核机构文本”
- 不会绕过机构主数据治理

---

### Phase 5：客户申请页把“待确认”升级成完整闭环

#### 目标

让代表提交新客户申请时，不只是看到“待确认”，而是能直接补机构申请。

#### 改造文件

- [src/components/crm/customer-application-form-dialog.tsx](/home/solarise/project-manage/src/components/crm/customer-application-form-dialog.tsx)

#### 当前现状

已有：

- `resolveOrganization()`
- 非 exact 时显示“待确认”

缺失：

- 不能主动选已有机构
- 不能在此处直接发起新机构申请

#### 改造方案

1. `OrganizationSelect` 改为统一组件模式
   - 代表也能搜已有机构
2. 当机构未命中时，增加显式 CTA：
   - `申请新建机构`
3. 成功申请后：
   - 保留 `organizationRawInput`
   - UI 提示：
     - `机构主数据申请已提交，客户申请将一并进入复核`

#### 文案建议

- 未命中但未申请：
  - `未在机构主数据中匹配到该单位。建议先申请新建机构，以便后续客户和订单统一归档。`
- 已申请：
  - `机构申请已提交，管理员复核后将回填机构主数据。`

---

### Phase 6：客户新建 / 快捷创建入口增加机构提醒

#### 目标

在“代表新建客户”相关场景，显式提醒机构主数据的重要性。

#### 需要覆盖的入口

1. `CustomerSelect` 的 quick-create 客户流程
   - [src/components/customer-select.tsx](/home/solarise/project-manage/src/components/customer-select.tsx)
2. 订单绑定客户时“新增客户并绑定”
   - [src/components/finance/customer-match-dialog.tsx](/home/solarise/project-manage/src/components/finance/customer-match-dialog.tsx)
3. 其他代表可触达的客户创建入口

#### 建议策略

代表侧若输入了机构文本但未绑定 `organizationId`：

- 表单提交前提示：
  - `当前客户未绑定正式机构主数据。建议先申请机构，以便后续客户、订单、CRM 统计统一。`

提供两个动作：

1. `继续保存客户`
2. `先申请机构`

#### 注意

这一步是提醒，不是阻塞。否则会破坏代表录入效率。

---

### Phase 7：把机构创建策略分成两条服务边界

#### 目标

消除“内部自动建机构”和“代表机构申请”混在一起的问题。

#### 当前问题

- [src/lib/organizations/ensure-organization.ts](/home/solarise/project-manage/src/lib/organizations/ensure-organization.ts)
  无匹配时直接建正式 `Organization`
- 这个逻辑适合：
  - 导入
  - 后台快捷建档
- 不适合：
  - 代表前台录入

#### 建议拆分

保留：

```ts
ensureOrganizationFromInput(rawName)
```

用途限定为：

- 内部导入
- 管理员/内部用户快捷建档

新增：

```ts
requestOrganizationReview(rawName, context)
```

用途限定为：

- 代表前台申请新机构

#### 好处

- 不再把“正式创建”和“申请创建”塞进一个函数
- 代码意图清晰

---

## 接口调整清单

### 1. `GET /api/organizations/list`

#### 调整

- 允许 `REPRESENTATIVE`
- 代表必须带 `search`
- 代表限制最少搜索长度和最大返回条数

### 2. `POST /api/organization-reviews/intake`

#### 调整

- 支持来源上下文参数
- 继续只允许非匿名登录用户
- 代表可调用

### 3. `POST /api/organizations/quick-create`

#### 调整

- `ADMIN` / `USER` 保持直建
- `REPRESENTATIVE` 不建议在这个接口里做分支复核

建议保持语义纯净：

- `quick-create` = 直建正式机构
- `organization-reviews/intake` = 发起机构申请

不要把一个接口做成“有时直建、有时申请”。那样后续会很难维护。

## 组件重构建议

### `OrganizationSelect`

重构为三个子能力：

1. `search existing`
2. `select existing`
3. `request create`

建议内部结构：

- `OrgSearchList`
- `OrgRequestAction`
- `OrgSelectedBadge / Display`

并把以下状态都保留在组件内部：

- `search`
- `open`
- `requesting`
- `quickName / requestName`

输出给上层的仍然只有：

- `onChange(...)`
- `onRequestCreate(...)`

## 数据模型是否需要改动

### 第一版建议：不改 Prisma

现有 `OrganizationReviewTask` 足够支撑第一版。

已有字段已经覆盖：

- `rawInput`
- `normalizedInput`
- `sourceType`
- `sourceId`
- `createdById`
- `status`

### 可选增强（二期）

如果后续想把“机构申请来自哪个业务上下文”做得更强，可以考虑补：

- `sourceMetaJson`

但这轮不必加。

## 回归验证

### 权限

1. 代表编辑自己客户
   - 可搜索已有机构
   - 可选择已有机构
   - 可发起新机构申请
2. 代表不能直建正式机构
3. 内部用户仍可快速创建正式机构

### 客户编辑

1. 代表把客户绑定到已有机构，保存后 `organizationId` 正确落库
2. 代表发起新机构申请后，客户保存为：
   - `organizationId = null`
   - `organizationRawInput = 原始文本`
3. 再次进入编辑页，能看到“机构待复核”状态

### 客户申请

1. 搜已有机构正常
2. 未命中时可申请新机构
3. 提交客户申请后，管理员能在机构复核页看到对应任务

### 内部入口

1. 导入、订单、项目等内部用户入口不回归
2. `quick-create` 仍创建正式机构

## 实施顺序

1. 重构 `OrganizationSelect` 能力模型
2. 放开 `GET /api/organizations/list` 的代表受限搜索
3. 接入 `organization-reviews/intake`
4. 改 `customer-edit-dialog`
5. 改 `customer-application-form-dialog`
6. 补代表侧客户创建提醒
7. 回归验证

## 建议给 DeepSeek 的执行边界

### 本轮要做

1. 代表能选已有机构
2. 代表能发起新机构申请
3. 客户编辑/客户申请入口接统一机构选择器
4. 统一文案提醒

### 本轮不要做

1. 重写管理端机构复核后台
2. 机构申请任务持久化更多元数据
3. 对所有项目/订单/发票页面全面替换文案和流程
4. 把 `ensureOrganizationFromInput()` 全局替换成复核逻辑

## 结论

这次不是单点修补，而是把“机构主数据”从当前的分散逻辑，收口成：

- 内部用户：可直建
- 代表：可搜索已有、可申请新建、不可直接落正式主数据
- 客户编辑/申请：统一接机构选择和复核提醒

复用现有 `OrganizationReviewTask` 和机构复核后台即可，不需要再造第三套机构申请机制。
