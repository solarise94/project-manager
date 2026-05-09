# 订单-项目-CRM-财务字段统一实施计划

## 状态

本文是给后续实现 agent 的执行文档，目标是把订单、项目、CRM、财务之间已经跑通的客户/代表同步能力扩展到项目管理，并补齐订单生成项目、项目编号/订单编号、成本、品牌、开票内容等字段口径。

本文不是长期架构讨论，重点是可落地修改。实现后必须跑：

```bash
npm run lint
npm run build
```

## 当前 Review 结论

### 已经具备的能力

1. 订单新建页已经能通过 `CustomerSelect` 读取客户电话、微信、单位和 CRM owner 对应代表。
2. `/api/customers/list` 和 `/api/customers` 已经返回 `representativeId` / `representativeName`。
3. `/api/projects` 和 `/api/projects/[id]` 后端已经使用 `resolveCustomerRepresentative()`，只要传了 `customerId`，项目代表会强制跟随 CRM owner。
4. `/api/orders` 后端也已经使用 `resolveCustomerRepresentative()`，只要订单有 `customerId`，订单代表会强制跟随 CRM owner。
5. 项目成本 `Project.budgetCost` 已经通过 `syncProjectBudgetCost()` 同步到 `FinanceCost`。
6. 采购渠道已经有完整 CRUD：`ProcurementChannel`、`/api/procurement-channels`、`/admin/procurement-channels`。

### 需要补齐的问题

1. 项目新建/编辑页面还没完整使用订单页那套客户选择结果。页面上代表仍然表现为可手动选择，用户容易以为可以覆盖 CRM owner。
2. 订单 `projectAction = GENERATE` 创建项目时只写了少量字段：`name/customerId/representative/budgetAmount/status`。它没有同步客户单位、客户快照、项目内容、采购渠道、品牌、技术支持、开始日期、项目成本，也没有创建项目 OWNER 成员和 ActivityLog。
3. `Project.orderNumber` 现在混用了“项目编号”和“订单号”。财务开票页还把它当作 `ProjectInvoice.projectCode` 默认值，这会和“项目号、订单号分开”冲突。
4. 新建订单时不能直接录入财务成本；如果订单同时生成项目，也没有把这个成本同步到 `FinanceCost`。
5. “品牌/来源品牌”还是自由文本，不像采购渠道一样可管理、可归档、可选择。
6. 项目开始日期页面默认空，订单日期页面默认当天；两边应统一为默认当天，可编辑。
7. 财务开票的“项目内容”实际是开票内容，不应该被项目内容字段长期占用。应支持默认调用项目名称，也可选择项目内容或手写开票内容。

## 字段权威口径

### 客户与 CRM

权威来源：

1. 客户身份：`Customer`
2. 客户单位：`Customer.organizationId` + `Customer.org.canonicalName`，没有 `organizationId` 时使用 `Customer.organization`
3. 客户电话/微信/地址：`Customer.principal` / `Customer.wechat` / `Customer.address`
4. CRM 负责人：`CrmCustomerProfile.ownerUserId`
5. 代表：CRM owner 对应的 `Representative`

规则：

1. 只要订单或项目绑定了 `customerId`，`representativeId` 必须从 CRM owner 派生。
2. 有 `customerId` 时，前端代表选择器必须禁用，显示“由客户 CRM 负责人同步”或“无匹配代表”。
3. 没有 `customerId` 时，才允许手动选择代表。
4. API 必须继续做硬校验，不能只靠前端禁用。

### 技术支持与项目负责人

短期不新增负责人字段，复用现有结构：

1. 项目负责人：`ProjectMember.role = OWNER`
2. 项目协作者：`ProjectMember.role = MEMBER`
3. 技术支持：继续使用 `Project.techSupport`

规则：

1. 项目独立创建时，创建人必须成为 OWNER。
2. 订单生成项目时，订单创建人必须成为生成项目的 OWNER。
3. 订单页如果展示“项目负责人/技术支持”，应读取关联项目，不要在订单表上复制一份负责人字段。

### 订单号与项目号

新增项目号，保留旧订单号字段做兼容：

1. `Order.orderNo`：订单系统内部订单号，格式继续 `SO-YYYYMMDD-0001`。
2. `Order.externalOrderNo`：外部平台订单号，例如拼好鼠订单号。
3. `Project.projectNo`：项目系统内部项目号，新增字段，格式建议 `PRJ-YYYYMMDD-0001`。
4. `Project.orderNumber`：保留为 legacy 订单号快照，后续页面不再把它叫“项目编号”。
5. `ProjectInvoice.projectCode`：仍保留字段名，但新建默认值改为 `Project.projectNo`。

页面规则：

1. 项目详情头部同时显示“项目号”和“关联订单”。
2. 项目列表卡片显示项目号；订单号从 `OrderProjectLink.order.orderNo/externalOrderNo` 读取。
3. 财务开票中的“项目编号”默认使用 `Project.projectNo`。
4. 老数据没有 `projectNo` 时，先 fallback 到 `orderNumber`，但新建项目必须有 `projectNo`。

### 金额与成本

权威来源：

1. 订单金额：`Order.totalAmount`，可被 `financeAmountOverride` 覆盖。
2. 项目金额：`Project.budgetAmount`。
3. 项目成本：`Project.budgetCost` + `FinanceCost(sourceKey = project-budget-cost:<projectId>)`。
4. 订单初始成本：新增 `FinanceCost(sourceKey = order-initial-cost:<orderId>)`，只在订单未生成项目或成本直接归属订单时使用。

规则：

1. 订单生成项目时，订单表单里的“项目成本”写入 `Project.budgetCost`，并通过 `syncProjectBudgetCost()` 写入 `FinanceCost`。
2. 订单不生成项目时，如果用户输入成本，创建一条 `FinanceCost` 关联 `orderId`。
3. 订单绑定已有项目时，不自动覆盖项目成本，页面可提示用户去项目/财务成本页同步。
4. 已有发票/回款/成本记录的订单，仍然遵守现有财务锁，不允许随意改金额。

### 项目类型、项目内容、采购内容、品牌

短期字段映射：

1. 项目类型：`Project.projectType`
2. 项目内容：`Project.projectContent`
3. 采购内容：当前没有独立字段，短期继续用 `Project.projectContent` 或订单明细 `OrderLine.itemName/spec` 预填；不要新增重复字段，除非业务确认“采购内容”和“项目内容”必须分开。
4. 采购渠道：`Project.procurementSource`
5. 来源品牌/品牌：`Project.brand`

订单生成项目时：

1. 订单行 `itemName` 默认作为项目内容候选。
2. 订单 `category` 映射到项目类型：`SERVICE -> 服务`，`PRODUCT -> 商品`，`MIXED -> 混合`。
3. 表单允许显式填写项目类型、项目内容、数量、采购渠道、品牌、技术支持。
4. 显式表单值优先级高于订单行自动推导。

### 开票内容

财务模块的“项目内容”本质是 `ProjectInvoice.contentSummary`，应改叫“开票内容”。

新建项目开票默认：

1. 默认模式：使用项目名称作为开票内容。
2. 可选模式：使用项目内容 `Project.projectContent`。
3. 可选模式：手写开票内容。

不建议把 `Project.projectContent` 直接当成开票内容强制同步，因为项目内容可能是样本、实验参数或采购细节，不一定符合发票文本。

## Schema 修改

### `Project`

在 `prisma/schema.prisma` 的 `Project` 中新增：

```prisma
projectNo String? @unique
```

索引建议：

```prisma
@@index([projectNo])
```

如果 Prisma 不允许 nullable unique + index 重复，保留 `@unique` 即可。

### `SourceBrand`

新增类似 `ProcurementChannel` 的模型：

```prisma
model SourceBrand {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  isDefault   Boolean  @default(false)
  archived    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

说明：

1. 不要急着把 `Project.brand` 改成 FK，先保持 string，避免历史数据迁移复杂化。
2. UI 用 `SourceBrand` 作为可选项，历史 brand 不在选项中时显示“历史：xxx”。

### Backfill 脚本

新增 `scripts/backfill-project-no.ts`：

1. 扫描 `Project.projectNo IS NULL`。
2. 按 `createdAt ASC` 生成 `PRJ-YYYYMMDD-0001`。
3. 遇到唯一冲突递增序号重试。
4. 输出回填数量。

运行：

```bash
npx tsx scripts/backfill-project-no.ts
```

## 后端修改

### 共享 helper

新增 `src/lib/business/customer-context.ts`：

```ts
resolveCustomerBusinessContext(customerId: string): Promise<{
  customerId: string;
  clientName: string;
  organizationId: string | null;
  organizationName: string | null;
  buyerPhone: string | null;
  buyerWechat: string | null;
  buyerAddress: string | null;
  representativeId: string | null;
  representativeName: string | null;
}>
```

实现要求：

1. 内部复用 `getCustomerOrganizationName()`。
2. 内部复用 `resolveCustomerRepresentative()`。
3. `/api/projects`、`/api/projects/[id]`、`/api/orders` 都使用它，避免三处各写一套。

新增 `src/lib/project-number.ts`：

```ts
generateProjectNo(txOrPrisma): Promise<string>
```

逻辑类似订单号生成，格式 `PRJ-YYYYMMDD-0001`。

### `/api/projects` POST

文件：`src/app/api/projects/route.ts`

修改：

1. 接收 `projectNo`，为空时自动生成。
2. 有 `customerId` 时，用 `resolveCustomerBusinessContext()` 填充：
   - `client`
   - `organization`
   - `representativeId`
   - `representative`
3. 没有 `customerId` 时，允许手动代表。
4. `startDate` 为空时默认当天。
5. 创建项目时继续创建 OWNER 成员。
6. 继续在同一事务里执行 `syncProjectBudgetCost()`。

### `/api/projects/[id]` GET/PATCH

文件：`src/app/api/projects/[id]/route.ts`

GET 修改：

1. 返回 `projectNo`。
2. `cust` select 增加 `principal/wechat/address`，方便项目页展示客户 CRM 快照。
3. `orderLinks.order` 已有 `orderNo/externalOrderNo`，保留。

PATCH 修改：

1. 接收 `projectNo`，校验唯一冲突返回 409。
2. 有 `customerId` 或已有 effective customer 时，用 `resolveCustomerBusinessContext()` 强制派生代表。
3. `customerId` 清空时，同步清空 `representativeId/representative`。
4. `startDate` 不要在编辑时自动覆盖，只有 POST 默认当天。
5. `budgetCost` 继续走 `syncProjectBudgetCost()`。

### `/api/orders` POST

文件：`src/app/api/orders/route.ts`

新增 body 字段：

```ts
projectDraft?: {
  projectNo?: string;
  projectType?: string;
  projectContent?: string;
  quantity?: number | string;
  procurementSource?: string;
  brand?: string;
  techSupport?: string;
  startDate?: string;
  budgetCost?: number | string;
}
initialCost?: number | string
initialCostType?: string
initialCostRemark?: string
```

事务要求：

1. 订单创建、订单行创建、订单生成项目、`OrderProjectLink`、成本写入必须在同一个 `prisma.$transaction()` 中。
2. `projectAction = GENERATE` 时，创建项目必须补齐：
   - `projectNo`
   - `name`
   - `description`
   - `customerId`
   - `client`
   - `organization`
   - `representativeId`
   - `representative`
   - `projectType`
   - `projectContent`
   - `quantity`
   - `procurementSource`
   - `brand`
   - `techSupport`
   - `budgetAmount`
   - `budgetCost`
   - `startDate`
   - OWNER 成员
   - ActivityLog
3. `projectAction = GENERATE` 且有 `budgetCost` 时，调用 `syncProjectBudgetCost(project.id, budgetCost, session.user.id, tx)`。
4. `projectAction != GENERATE` 且有 `initialCost` 时，创建 `FinanceCost`：
   - `orderId = order.id`
   - `customerId = order.customerId`
   - `sourceType = "ORDER_INITIAL_COST"`
   - `sourceKey = order-initial-cost:<orderId>`
5. `projectAction = LINK` 时，不自动改项目字段。只创建 link。后续通过项目页同步按钮处理。

注意：

当前 `/api/orders` 是先创建订单，再在事务外创建项目。这个必须改成一个事务，否则订单创建成功但项目/成本失败会留下半成品。

### 新增项目从订单同步 API

新增：`src/app/api/projects/[id]/sync-from-order/route.ts`

权限：

1. ADMIN only 或 `canManageProject()` 为 true。
2. 只能同步已经通过 `OrderProjectLink` 关联到当前项目的订单。

Body：

```ts
{
  orderId: string;
  fields: Array<"ORDER_NUMBER" | "CUSTOMER_CRM" | "PROJECT_INFO" | "AMOUNT" | "COST">;
  costMode?: "IGNORE" | "ORDER_COST_TO_PROJECT_COST";
}
```

字段含义：

1. `ORDER_NUMBER`：把 `Order.externalOrderNo || Order.orderNo` 写入 `Project.orderNumber` legacy 快照。
2. `CUSTOMER_CRM`：按订单 `customerId` 同步项目 `customerId/client/organization/representative`。
3. `PROJECT_INFO`：从订单首行或订单标题同步 `projectType/projectContent/quantity`，只覆盖空字段，除非 body 未来增加 `overwrite=true`。
4. `AMOUNT`：调用现有 `/sync-order-amount` 的同等逻辑或复用 helper，不重复写新金额算法。
5. `COST`：如果订单有 `FinanceCost` 且项目没有 `budgetCost`，允许同步到项目成本。

ActivityLog：

1. 每次同步写 `PROJECT_UPDATED`。
2. metadata 记录 `orderId`、`fields`、旧值和新值。

## 品牌管理

### API

新增：

1. `src/app/api/source-brands/route.ts`
2. `src/app/api/source-brands/[id]/route.ts`

行为完全参考 `/api/procurement-channels`：

1. GET 登录可用，默认排除 archived。
2. `includeArchived=true` 只有 ADMIN 可看。
3. POST/PATCH 只有 ADMIN。
4. `isDefault=true` 时取消其他默认项。
5. name 唯一冲突返回 409。

### 页面

新增：

1. `src/app/admin/source-brands/page.tsx`

可以直接复制 `admin/procurement-channels/page.tsx` 的结构，文案改为“来源品牌管理”。

### 选择组件

新增：

1. `src/components/source-brand-select.tsx`

或抽一个通用 `ManagedOptionSelect`，但不要为了这次需求做大重构。最小实现可以只做 `SourceBrandSelect`。

使用位置：

1. `src/app/projects/page.tsx` 新建项目
2. `src/app/projects/[id]/page.tsx` 编辑项目
3. `src/app/orders/new/page.tsx` 的生成项目区域

历史值处理：

如果当前 `brand` 不在可选项中，Select 里显示 `历史：${brand}`，允许保留。

## 前端修改

### 项目新建页

文件：`src/app/projects/page.tsx`

修改：

1. 表单新增 `projectNo`，可以留空自动生成。
2. `startDate` 初始值设为当天。
3. 打开新建 Dialog 时，如果 `startDate` 为空，填当天。
4. `CustomerSelect` 使用第五个参数 `customer`：
   - 自动填 `client`
   - 自动填 `organization`
   - 自动设置 `selectedOrgId`
   - 自动设置 `representativeId/representative`
5. 有 `customerId` 时，代表选择器改为 disabled 输入框，文案同订单页：
   - 有代表：显示代表名
   - 无代表：显示“无匹配代表”
6. 无 `customerId` 时，保留 `RepresentativeSelect`。
7. `CustomerSelect` 传 `quickCreateDefaults`：
   - `name: form.client`
   - `organization: form.organization`
   - `organizationId: selectedOrgId`
8. 品牌输入框改成 `SourceBrandSelect`。

### 项目详情编辑

文件：`src/app/projects/[id]/page.tsx`

修改：

1. 编辑表单加入 `projectNo`。
2. 客户选择逻辑和项目新建页一致。
3. 有客户时禁用代表手动选择。
4. 品牌输入框改成 `SourceBrandSelect`，保留历史值。
5. 项目详情头部显示：
   - 项目号：`project.projectNo || "未生成"`
   - 关联订单：读取 `project.orderLinks`
   - legacy 订单号快照：如果 `project.orderNumber` 存在，显示为“订单号快照”
6. Orders Tab 增加“同步订单信息到项目”按钮，打开 Dialog 调用 `/api/projects/[id]/sync-from-order`。

### 订单新建页

文件：`src/app/orders/new/page.tsx`

修改：

1. 保留订单日期默认当天，后端也继续默认当天。
2. 当 `projectAction === "GENERATE"` 时显示“生成项目信息”区域：
   - 项目号，可留空自动生成
   - 项目类型
   - 项目内容
   - 数量
   - 采购渠道
   - 来源品牌
   - 技术支持
   - 项目开始日期，默认当天
   - 项目成本
3. 当 `projectAction !== "GENERATE"` 时显示“订单成本”字段：
   - 初始成本
   - 成本类型
   - 成本备注
4. 提交时：
   - `projectAction=GENERATE`：把项目字段放入 `projectDraft`
   - `projectAction!=GENERATE`：把成本放入 `initialCost`
5. 从项目创建订单 `?fromProjectId=` 时，额外预填：
   - 项目号
   - 项目类型
   - 项目内容
   - 采购渠道
   - 品牌
   - 技术支持
   - 项目成本

### 订单编辑页

文件：`src/components/orders/order-edit-dialog.tsx`

短期只做显示一致：

1. 客户选择后继续自动填买方快照和代表。
2. 有客户时代表禁用。
3. 不在订单编辑里直接改已生成项目的项目字段，避免绕过项目权限和成本同步。

### 财务项目开票

文件：

1. `src/app/finance/project-invoices/page.tsx`
2. `src/components/invoice-form-dialog.tsx`
3. `src/app/api/projects/[id]/invoice-draft/route.ts`

修改：

1. `ProjectItem` 增加 `projectNo/projectContent/budgetAmount`。
2. `invoiceDefaults.projectCode` 改为：
   - `defaultProject.projectNo`
   - fallback `defaultProject.orderNumber`
   - fallback 空
3. 新增 `invoiceContentMode` UI：
   - `PROJECT_NAME`：默认，`contentSummary = project.name`
   - `PROJECT_CONTENT`：`contentSummary = project.projectContent`
   - `MANUAL`：用户手写
4. 明细行默认：
   - `itemName = contentSummary || project.name`
   - `amount = project.budgetAmount || ""`
5. AI invoice draft 中继续可以覆盖空字段，但不能覆盖用户已经手写的开票内容。

## 导出与展示

### 飞书导出

文件：`src/lib/feishu-export.ts`

修改：

1. 新增项目号列或把原“订单号”拆成两列：
   - 项目号：`projectNo`
   - 订单号：`orderNumber` 或关联订单号列表
2. 关联订单号优先从 `orderLinks` 取，fallback 到 `orderNumber`。

### 类型定义

文件：`src/lib/types.ts`

修改：

1. `ProjectItem` 增加 `projectNo?: string | null`。
2. `ProjectItem.orderLinks.order` 已有订单字段，确认页面读取时不再误用 `orderNumber` 当项目号。

## 实施顺序

### Phase 1：Schema 与管理项

1. 修改 Prisma schema：`Project.projectNo`、`SourceBrand`。
2. `npx prisma db push`。
3. 新增 `scripts/backfill-project-no.ts` 并执行。
4. 新增 source brand API 和 admin 页面。
5. 新增 `SourceBrandSelect`。

验收：

1. 新老项目都有 `projectNo`。
2. 品牌可新建、编辑、归档、设默认。
3. `npm run lint && npm run build` 通过。

### Phase 2：客户 CRM 同步到项目管理

1. 新增 `resolveCustomerBusinessContext()` helper。
2. 项目 POST/PATCH 改用 helper。
3. 项目新建/编辑页接入 `CustomerSelect` 第五参数。
4. 有客户时代表禁用显示。

验收：

1. 项目选择客户后自动显示单位和 CRM 负责人代表。
2. 客户无 CRM owner 时代表留空。
3. API 直接传 `customerId + representativeId` 时，最终代表仍按 CRM owner。
4. 清空客户时同步清空代表。

### Phase 3：订单生成项目补齐字段

1. `/api/orders` POST 改为事务。
2. `projectAction=GENERATE` 使用完整项目创建逻辑。
3. 创建 OWNER 成员和 ActivityLog。
4. 同步 `budgetCost` 到 `FinanceCost`。
5. 订单新建页增加生成项目字段。

验收：

1. 新建订单并生成项目后，项目详情中客户、单位、代表、项目类型、项目内容、采购渠道、品牌、技术支持、金额、成本、开始日期都正确。
2. 生成项目有 OWNER 成员。
3. 成本页能看到 `project-budget-cost:<projectId>` 对应成本。
4. 订单和项目之间有 `OrderProjectLink(relationType=GENERATED)`。

### Phase 4：项目号/订单号拆分和同步

1. 项目页面显示项目号和关联订单号。
2. 财务开票默认 `projectCode = project.projectNo`。
3. 新增 `/api/projects/[id]/sync-from-order`。
4. 项目 Orders Tab 加同步 Dialog。

验收：

1. 项目号不再显示成订单号。
2. 项目可从关联订单同步订单号快照。
3. 财务开票的项目编号默认项目号。
4. 老项目没有项目号时 fallback 正常。

### Phase 5：财务开票内容与订单成本

1. 发票 Dialog 加开票内容模式。
2. 项目开票默认使用项目名称。
3. 允许选择项目内容或手写。
4. 订单不生成项目时，允许创建 order-level 初始成本。

验收：

1. 新建项目发票默认开票内容为项目名。
2. 切换到项目内容后，开票内容变为 `project.projectContent`。
3. 手写内容不会被 AI 或默认值覆盖。
4. 新建订单输入初始成本但不生成项目时，财务成本列表出现关联订单的成本。

## 风险与 Guard

1. 不要把 `Project.orderNumber` 直接重命名或删除。它已有历史数据和导出引用，先作为 legacy 字段保留。
2. 不要让前端代表禁用成为唯一约束。项目和订单 API 必须继续强制 CRM owner 派生。
3. 不要在订单编辑页直接改项目成本。项目成本必须走项目 PATCH 或订单生成项目事务。
4. `OrderProjectLink` 是订单和项目的关系事实，不要通过复制订单号字符串代替关系。
5. `ProjectInvoice.projectCode` 字段名可以暂时不改，避免发票历史迁移；只改新建默认值和页面文案。
6. 品牌先做管理项，不强制历史项目迁移到 FK。
7. `projectAction=GENERATE` 必须事务化，防止订单成功但项目/成本失败。

## 最终验收矩阵

| 场景 | 期望 |
| --- | --- |
| 项目新建选择已有客户 | 自动带出客户单位和 CRM 负责人代表，代表不可手动覆盖 |
| 项目新建快速创建客户 | 创建客户后项目表单可选中客户，并按 CRM owner 同步代表 |
| 项目清空客户 | 项目代表同步清空 |
| 订单新建选择客户 | 继续自动带出电话、微信、单位、代表 |
| 订单新建并生成项目 | 项目字段完整，项目有 OWNER，成本同步到 FinanceCost |
| 订单新建但不生成项目，填写成本 | 创建 order-level FinanceCost |
| 项目详情 | 项目号和关联订单号分开展示 |
| 项目从订单同步 | 只允许从已关联订单同步，写 ActivityLog |
| 项目开票 | 项目编号默认项目号；开票内容默认项目名称，可改项目内容或手写 |
| 来源品牌 | 可管理、可归档、可设默认，项目/订单生成项目可选择 |
| 日期默认 | 新建项目和新建订单日期默认当天，可手动改 |
| 构建 | `npm run lint && npm run build` 零错误 |
