# Dialog 移动端滚动兼容性问题与修复计划

## 背景

近期在 CRM 工作台快捷入口中发现一个移动端兼容性问题：

- 入口：`/crm` 工作台顶部快捷操作中的“申请新增客户”
- 现象：在 Oppo（安卓）自带浏览器中，长表单弹层无法正常上下滑动
- 对比：Safari、Chrome 下表现正常

该问题初看像是 CRM 单点缺陷，但审阅后确认更接近一类**通用弹层滚动兼容性问题**，很可能影响全应用所有“长表单 + Dialog 弹窗”的实现。

---

## 直接问题

### 1. CRM“申请新增客户”弹层命中了高风险滚动模式

当前实现：

- 组件：`src/components/crm/customer-application-form-dialog.tsx`
- 弹层容器：`<DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">`

也就是说：

1. 弹层本体本身负责滚动
2. 滚动容器就是 `DialogContent`
3. 高度依赖 `vh`

对应代码位置：

- `src/components/crm/customer-application-form-dialog.tsx:337`

### 2. `DialogContent` 的底层结构本身对安卓浏览器不友好

`DialogContent` 当前是通用基础组件，核心布局特征如下：

- `position: fixed`
- `top: 50%`
- `left: 50%`
- `transform: translate(-50%, -50%)`

对应代码位置：

- `src/components/ui/dialog.tsx:53-58`

这意味着当前的长表单弹窗，本质上是在一个：

- `fixed`
- 居中
- 带 transform
- 自身承担滚动

的节点上处理触摸滚动。

在 iOS Safari 和 Chrome 上这通常没问题，但在部分安卓厂商浏览器或 WebView 内核中，这是一个非常典型的兼容性风险组合。

---

## 问题来源判断

### 结论

当前最可疑的根因不是 CRM 表单字段本身，也不是某个特定输入组件，而是：

**“带 transform 的 fixed Dialog Popup 本体直接承担 `overflow-y-auto` 滚动” 这一通用实现模式。**

### 为什么这样判断

#### 1. 现象特征吻合浏览器兼容性问题

用户反馈特征为：

- Oppo 自带浏览器异常
- Safari / Chrome 正常

这类“特定安卓浏览器异常、主流现代浏览器正常”的问题，通常不是业务逻辑问题，而是：

- 滚动容器选择不稳定
- `vh` / 可视区域高度处理不一致
- `fixed + transform + overflow` 组合兼容性差
- 弹层内部触摸滚动链路被浏览器拦截或错误处理

#### 2. 代码里已经存在两套不同的弹层滚动模式

仓库内目前并不统一，至少存在两类写法。

高风险写法：

- 直接让 `DialogContent` 滚动
- 示例：
  - `src/components/crm/customer-application-form-dialog.tsx`
  - `src/app/admin/representatives/page.tsx`
  - `src/app/projects/page.tsx`
  - `src/app/projects/[id]/page.tsx`
  - `src/app/crm/customer-applications/page.tsx`

相对稳妥写法：

- `DialogContent` 自身 `overflow-hidden`
- 内部再包一层 `min-h-0 overflow-y-auto`
- 示例：
  - `src/app/admin/organizations/page.tsx`
  - `src/app/admin/organization-reviews/page.tsx`

这说明项目里已经有经验性规避方案，只是没有上升为统一规范。

#### 3. `Sheet` 结构比 `Dialog` 风险更低

移动端筛选等一些长内容区域已经使用 `Sheet`：

- `src/app/orders/page.tsx`
- `src/app/crm/customers/page.tsx`
- `src/app/crm/customer-pool/page.tsx`

`SheetContent` 是贴边定位，不依赖居中 translate，因此天然比当前 `DialogContent` 模式更不容易触发安卓滚动兼容问题。

---

## 影响范围

### 高风险范围

所有满足以下条件的弹层都应视为高风险：

1. 使用 `DialogContent`
2. `DialogContent` 自身带 `overflow-y-auto`
3. 内容长度可能超过一个移动屏
4. 主要使用场景包含安卓浏览器 / 厂商浏览器 / WebView

已确认典型点位包括：

- `src/components/crm/customer-application-form-dialog.tsx`
- `src/app/admin/representatives/page.tsx`
- `src/app/crm/customer-applications/page.tsx`
- `src/app/projects/page.tsx`
- `src/app/projects/[id]/page.tsx`
- `src/components/draft-preview.tsx`
- `src/components/orders/order-edit-dialog.tsx`
- `src/components/invoice-form-dialog.tsx`
- `src/components/finance/order-revision-dialog.tsx`
- `src/app/finance/order-matching/page.tsx`

### 中风险范围

以下场景虽然也用了 Dialog，但当前不一定会直接复现：

1. 表单较短，不需要滚动
2. 仅桌面端使用
3. 内部用户使用 Chrome 为主

例如：

- `src/app/admin/users/page.tsx`
- `src/app/crm/graph/page.tsx`

它虽然也使用 `DialogContent`，但当前表单高度不长，不是这次问题的主战场。

其中 `src/app/crm/graph/page.tsx:389` 需要单独说明：

- 滚动容器不是 `DialogContent` 本体，而是内部 `<div>`
- 这比“Dialog 本体直接滚动”更安全
- 但高度仍然使用 `max-h-[60vh]`
- 因此仍有移动端可视区域计算偏差风险，属于中风险

### 半迁移范围

这类点位已经做了部分修正，但尚未完成结构级收敛：

- `src/app/admin/organizations/page.tsx:767`

它已经：

- 从 `vh` 切到了 `dvh`

但仍然：

- 直接让 `DialogContent` 自身承担 `overflow-y-auto`

因此它不应归类为“安全模式”，而应视为“已改一半、仍需迁移”的状态。

---

## 风险排序

### P0

- CRM 快捷入口“申请新增客户”

原因：

- 是用户已反馈的真实问题
- 是长表单
- 是移动端高频入口
- 是 CRM 当前活跃迭代区域

### P1

- 其他直接让 `DialogContent` 滚动的长表单弹层

### P2

- 短表单 Dialog
- 低频后台管理弹层

---

## 修复目标

修复不应只针对某一个 CRM 组件做补丁，而应建立统一策略：

1. 为移动端长表单弹层定义统一、安全的结构模式
2. 把高风险 Dialog 逐步迁移到该模式
3. 视情况补充 `dvh`、安全区和滚动行为约束
4. 避免以后继续新增“Dialog 本体直接滚动”的实现

---

## 建议修复方案

### 方案 A：统一长表单 Dialog 结构

推荐把长表单 Dialog 统一收敛为以下结构：

1. `DialogContent`
   - 只负责定位和外层布局
   - 使用 `max-h-[85dvh]`
   - 使用 `overflow-hidden`
   - 使用 `grid` / `flex` 固定头部、滚动区、底部按钮区
2. 内部滚动容器
   - `min-h-0 overflow-y-auto`
   - `overscroll-behavior: contain`
   - `-webkit-overflow-scrolling: touch`
   - 只让这一层承担滚动
3. 底部按钮区
   - 独立区域
   - 必要时加 `safe-area-inset-bottom`

这也是仓库里已有的较稳模式。

建议把 `src/app/admin/organizations/page.tsx:698` 作为迁移模板参考。其核心结构如下：

1. 外层 `DialogContent`
   - `max-h-[85dvh]`
   - `grid-rows-[auto_minmax(0,1fr)_auto]`
   - `overflow-hidden`
2. 中间滚动层
   - `-mx-4 min-h-0 overflow-y-auto px-4 pb-1`

这套模式已经接近本项目当前最完整的安全写法。

### 方案 B：为通用 Dialog 组件提供“长内容安全模式”

可选做法：

在 `src/components/ui/dialog.tsx` 中保留通用 `DialogContent`，但补充一个明确语义的变体或约定，例如：

- `DialogContent` 继续用于普通短弹窗
- 新增长内容专用模式，避免每个业务页面自己拼样式

目标不是做大而全组件，而是减少业务层重复犯错。

### 方案 C：统一从 `vh` 迁移到 `dvh`（应与方案 A 同步实施）

对所有移动端长弹层优先使用：

- `max-h-[85dvh]`

而不是：

- `max-h-[85vh]`

原因：

- `dvh` 更贴近真实动态可视区域
- 对安卓浏览器地址栏伸缩更稳
- 可减少底部区域被遮挡、滚动范围计算失真等副作用
- 在安卓浏览器地址栏动态收缩时，`vh` 计算往往偏大，可能直接导致弹层高度超出真实可视区域
- 当弹层本体高度超出真实视口、而滚动容器又设置在高风险节点上时，这本身就可能成为“无法正常滚动”的触发因素之一

因此 `dvh` 不应视为锦上添花，而应作为移动端长弹层修复的基础项，与方案 A 同步推进，而不是放在后续可选优化。

### 方案 D：补齐触摸滚动相关 CSS 约束

即使完成结构迁移，如果不补足触摸滚动行为约束，安卓 WebView / 厂商浏览器中仍可能出现：

1. 滚动穿透
2. 底层页面跟着滚
3. 橡皮筋效果导致的卡顿或假死
4. 输入框聚焦后滚动链路异常

建议在内部滚动容器上纳入以下约束：

1. `overscroll-behavior: contain`
2. `-webkit-overflow-scrolling: touch`

当前仓库中尚未发现任何地方使用：

1. `touch-action`
2. `overscroll-behavior`
3. `-webkit-overflow-scrolling`

这意味着当前实现对安卓触摸滚动链路几乎没有做针对性约束。

### 方案 E：审查 Overlay 对触摸链路的影响

文档当前重点在 Popup 本体和内部滚动容器，但还应补充一项检查：

1. `DialogOverlay` 的 `pointer-events`
2. `DialogOverlay` 的 `touch-action`
3. Overlay 是否在特定安卓浏览器中意外参与触摸链路拦截

当前还没有证据表明 overlay 是主因，但在部分安卓浏览器中，overlay 的交互设置确实可能影响下层滚动链路。修复阶段应把它列为一个明确检查项，而不是默认忽略。

---

## 分阶段计划

### 第一阶段：建立规范并修复已知问题点

目标：

1. 修复 CRM 快捷入口“申请新增客户”
2. 明确“长表单 Dialog 的标准结构”
3. 形成可复用的实现模板

输出：

- 一个安全结构范式
- 至少一个真实业务页面迁移完成

### 第二阶段：批量审计并替换高风险 Dialog

目标：

1. 检查所有 `DialogContent + overflow-y-auto` 的长表单
2. 标注高风险页面
3. 分批迁移到统一结构

建议优先顺序：

1. CRM 相关长表单
2. 项目创建/编辑
3. 订单/发票/财务编辑
4. 后台管理长表单

建议把审计命令直接写入执行步骤，避免人工逐页查找：

```bash
rg -n 'DialogContent className=.*overflow-y-auto|max-h-\\[[0-9]+(d)?vh\\].*overflow-y-auto' src
```

同时补一组针对内部滚动容器和 Sheet 的搜索：

```bash
rg -n 'max-h-\\[[0-9]+vh\\]|max-h-\\[[0-9]+dvh\\]|overflow-y-auto|SheetContent' src
```

这样可以同时覆盖：

1. `DialogContent` 本体直接滚动
2. 内部滚动容器仍在使用 `vh`
3. `Sheet` 中 `vh` / `dvh` 不一致

### 第三阶段：沉淀为组件层约束

目标：

1. 降低业务页面继续写出高风险结构的概率
2. 为后续迭代提供默认安全模式

可选动作：

1. 给 `Dialog` 增加长内容变体
2. 补一份组件使用约定文档
3. 在 code review 中把“`DialogContent` 自身滚动”列为检查项

---

## 验证建议

修复后不应只在桌面 Chrome 检查，应至少覆盖：

1. Oppo / 安卓厂商浏览器
2. Android Chrome
3. iPhone Safari
4. 桌面 Chrome

重点验证项：

1. 表单在弹层内能连续上下滑动
2. 输入框聚焦后页面不会卡死或滚动错位
3. 底部按钮可达且不会被地址栏/安全区遮挡
4. 打开键盘后弹层仍可操作
5. 弹层关闭后页面滚动状态正常
6. 不会发生滚动穿透到底层页面
7. overlay 不会吞掉内部滚动手势

---

## Sheet 补充说明

`Sheet` 整体风险低于当前 `Dialog` 居中弹层模式，但并不代表可以忽略。

当前至少存在以下不一致点：

- `src/app/crm/relations/page.tsx:101`
  - `SheetContent side="top" className="h-auto max-h-[50vh]"`
  - 这里仍然使用了 `vh`，而不是 `dvh`

因此第二阶段不应只审计 `Dialog`，还应统一检查 `Sheet` 中所有移动端高度相关用法，至少完成：

1. `vh -> dvh` 的一致化
2. 长内容滚动结构的统一审查

---

## 本次审阅结论

本次问题可以明确归因为一类**通用移动端弹层滚动兼容性设计缺陷**，而不只是 CRM 单点 bug。

最优修复策略不是“给某个页面单独打补丁”，而是：

1. 先修 CRM“申请新增客户”这一已知问题入口
2. 同时定义统一的长表单 Dialog 结构
3. 再批量清理全应用高风险实现

这样才能既解决当前 Oppo 浏览器问题，又避免后续继续在其他页面重复出现同类故障。
