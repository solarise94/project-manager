# 代表编辑客户主数据 + 手机端绑定客户体验修复方案

## 目标

1. REPRESENTATIVE 可以修改自己负责客户的客户主数据
2. 手机端“绑定客户”流程不再出现候选框溢出、横向顶出弹层的问题

## 问题定位

1. 代表编辑权限被后端直接拦死
    - `src/app/api/customers/[id]/route.ts:12` 和 `:41` 对 REPRESENTATIVE 直接 403
    - 客户详情页编辑按钮也只给 ADMIN：`src/app/crm/customers/[sourceCustomerId]/page.tsx:74`
2. 手机端绑定客户体验差，至少有两个具体原因
    - 绑定客户列表项没有做充分的 truncate/min-w-0，长单位名会把整行撑出去：`src/components/finance/customer-match-dialog.tsx:243`
    - 新增客户里的单位选择仍是桌面 Popover，移动端宽度跟随 trigger，长候选项容易越界：`src/components/organization-select.tsx:130`

---

## Phase 1：明确权限口径

- ADMIN / USER：保持现状，可编辑任意客户
- REPRESENTATIVE：仅可编辑“自己名下 CRM 档案绑定的 sourceCustomer”
- REGIONAL_MANAGER：这轮先不开放编辑，只保留查看

### 可编辑字段分两层

- 客户主数据 Customer：name / principal / email / wechat / organization / organizationId / organizationSiteId / organizationRawInput / address / miniProgramId / labOrGroup
- CRM 档案字段 CrmCustomerProfile：代表维持现在的限制，可改 summary/personCategory/jobTitle/graduationDate，不开放改 stage / importance / ownerUserId

---

## Phase 2：抽一个“客户可编辑性”共享校验

新增文件：`src/lib/customers/permissions.ts`

新增函数：`assertCustomerEditable(customerId, userId, role)`

逻辑：
1. 查 customer，不存在或 deleted -> NOT_FOUND
2. ADMIN / USER -> 放行
3. REPRESENTATIVE -> 查 crmCustomerProfile by sourceCustomerId = customerId，要求 profile 存在、ownerUserId === userId、assignmentStatus === "ASSIGNED"，否则 FORBIDDEN
4. REGIONAL_MANAGER -> 直接 FORBIDDEN
5. 其他角色 FORBIDDEN

---

## Phase 3：放开 customers API 的 GET/PATCH

改文件：`src/app/api/customers/[id]/route.ts`

- GET：不再对 REPRESENTATIVE 一刀切 403，改成可编辑即可读取（assertCustomerEditable）
- PATCH：不再对 REPRESENTATIVE 一刀切 403，改成 assertCustomerEditable()
- DELETE：维持现状，不给代表开放
- 字段保护：REPRESENTATIVE 传 archived 直接忽略（仅 ADMIN/USER 处理 archived）

---

## Phase 4：前端详情页开放代表编辑入口

改文件：`src/app/crm/customers/[sourceCustomerId]/page.tsx`

新增 `canEditCustomer`：
```ts
const canEditCustomer =
  session?.user?.role === "ADMIN" ||
  session?.user?.role === "USER" ||
  (session?.user?.role === "REPRESENTATIVE" && profile.ownerUser?.id === session.user.id);
```

替换两处 `session?.user?.role === "ADMIN"`：
- 顶部“编辑客户”按钮
- 底部 CustomerEditDialog 挂载条件

---

## Phase 5：CustomerEditDialog 小幅收口

改文件：`src/components/crm/customer-edit-dialog.tsx`

- 保留现有 CRM 字段编辑（/api/crm/profiles/[id] 已对代表做了字段限制）
- 可选：把表单分组为“客户主数据”和“CRM 补充信息”
- PATCH customer 返回 403 时 toast 显示“只能编辑自己负责的客户”

---

## Phase 6：手机端绑定客户弹窗布局修复

改文件：`src/components/finance/customer-match-dialog.tsx`

1. DialogContent 限宽防溢出：`w-[calc(100vw-1rem)] max-w-md overflow-x-hidden p-4 sm:w-full`
2. 现有客户候选列表：外层滚动区加 min-w-0，每个按钮内部文本容器都加 min-w-0，名称/单位/联系方式/代表名都用 truncate
3. Tabs 在手机端改短文案："已有客户" / "新增并绑定"

---

## Phase 7：移动端单位选择从 Popover 切换成 Sheet/Drawer

改文件：`src/components/organization-select.tsx`

1. 内部引入 `useMediaQuery("(max-width: 767px)")`
2. 桌面端维持现有 Popover
3. 移动端切成 Sheet：顶部搜索框、中间滚动列表、底部“快速添加单位”
4. 移动端候选行全部做 min-w-0 + truncate，地址副标题 truncate

次优方案（若 sheet 改动过大）：PopoverContent 加 viewport clamp 宽度

---

## Phase 8：回归验证清单

### 权限回归
1. 代表打开自己负责客户详情 → 可见“编辑客户”→ 打开弹窗成功加载 → 修改成功
2. 代表打开非自己负责客户详情 → 不显示“编辑客户”→ 直调 PATCH 返回 403
3. ADMIN/USER 编辑能力不回归
4. 代表尝试改 archived → 不生效

### 移动端回归
1. /orders/[id] 点击“绑定客户” → 弹窗不横向溢出
2. “绑定已有客户” → 长客户名/长单位名/长微信号不会把卡片撑出屏幕
3. “新增客户并绑定” → 点击“单位”时候选层不跑出视口，列表能正常滚动
4. 检查 375px / 390px / 412px 宽度

---

## 建议执行顺序

1. 抽 assertCustomerEditable
2. 改 /api/customers/[id] GET/PATCH
3. 改 CRM 客户详情页入口显示
4. 修 customer-match-dialog 的 mobile 布局
5. 把 organization-select 做成 mobile sheet
6. lint + tsc + 移动端回归
