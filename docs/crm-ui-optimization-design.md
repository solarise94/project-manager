# CRM UI 优化设计方案

> 目标：提升 CRM 模块在桌面端与移动端的易用性、美观性与一致性。

---

## 1. 当前问题诊断

### 1.1 移动端体验

| 页面 | 问题 | 影响 |
|------|------|------|
| CRM 主页 | 快捷导航按钮过小（h-9，36px），低于触控建议热区 44px | 误触、点击困难 |
| CRM 主页 | 两列网格过挤，gap-2（8px）导致文字换行 | 视觉拥挤、难以辨识 |
| 客户详情页 | Sticky 操作栏无背景模糊/阴影，滚动时与内容融为一体 | 视觉层级混乱 |
| 客户详情页 | Tabs 移动端降级为 Select，切换后内容跳动 | 交互心智模型不一致 |
| 客户池/流转池 | Card 整体 clickable，内部操作按钮需 stopPropagation | 触控设备极易误触 |
| 跟进任务页 | "完成"按钮 size="sm"，触控热区不足 | 操作困难 |
| 关系图谱 | 搜索结果 dropdown 无外部点击关闭逻辑 | 遮挡内容、体验差 |

### 1.2 视觉一致性

| 问题 | 位置 | 现状 |
|------|------|------|
| Badge 样式不统一 | CheckinsTab、InteractionsTab | 手动写 `rounded` 而非 `rounded-full` |
| 卡片内边距混乱 | 全站 | `p-3`、`p-4`、`pt-4` 混用 |
| 空状态简陋 | 全站 | 纯文本 "暂无数据" |
| 表格列过多 | 客户池桌面端 | 12 列，大量 `hidden lg:table-cell` |

### 1.3 交互与反馈

| 问题 | 影响 |
|------|------|
| 缺乏骨架屏加载态 | 数据量大时体验差 |
| 沟通记录无分页（固定 slice 0-8） | 信息截断无提示 |
| 转写文本展开/收起为原生 details | 样式简陋、无动画 |
| 筛选器标签重复实现 | 维护成本高 |

---

## 2. 设计原则

1. **移动优先**：触控热区 ≥ 44×44px，按钮高度 ≥ 48px（移动端）
2. **视觉层级清晰**：背景模糊、阴影、色条区分功能模块
3. **一致性**：统一卡片、空状态、Badge、按钮规范
4. **信息降噪**：次要信息折叠/隐藏，避免认知过载
5. **即时反馈**：点击态（active:scale）、悬停态、加载态

---

## 3. 组件规范

### 3.1 CrmQuickNavCard（快捷导航卡片）

```tsx
// 规格
- 移动端：单列，h-14（56px），px-4
- 桌面端：可保持网格或改为横向滚动
- 左侧 4px 色条（border-l-4）区分模块
- 图标 h-5 w-5
- 右侧 ChevronRight
- active:scale-[0.98] transition-transform
- hover:bg-muted/80
```

**色条映射**：
- 客户池：border-blue-500
- 跟进任务：border-orange-500
- 关系网络：border-purple-500
- 关系图谱：border-indigo-500
- 客户申请：border-green-500
- 机构分析：border-cyan-500
- 代表运营：border-pink-500
- 地区经理：border-amber-500

### 3.2 CrmEmptyState（空状态）

```tsx
// 规格
- 图标：lucide 相关图标，h-10 w-10，opacity-40
- 主标题：text-sm font-medium
- 副标题（可选）：text-xs text-muted-foreground
- 垂直居中，py-12
```

### 3.3 CrmCard（统一卡片）

```tsx
// 规格
- 移动端：p-3
- 桌面端：p-4
- hover:border-primary/50 transition-colors（可点击时）
```

### 3.4 ActiveFilterBar（筛选标签栏）

```tsx
// 规格
- 自动收集所有 active filter
- 每个标签带删除按钮（X）
- 支持"清空全部"
- 移动端可横向滚动
```

---

## 4. 页面级改进方案

### 4.1 CRM 主页（/crm/page.tsx）

**改进项**：
1. **快捷导航按钮重构**
   - 移动端改为单列纵向大卡片（h-14）
   - 添加左侧色条 + 右侧箭头
   - 增加触控反馈（active:scale-[0.98]）
2. **Metrics Cards 优化**
   - 极小屏幕下改为 2 列（grid-cols-2）避免挤压
   - 数值 font-bold → font-semibold（避免过粗）
3. **最近沟通列表优化**
   - 添加"查看全部"链接（跳转到客户详情 interactions tab）

### 4.2 客户详情页（/crm/customers/[id]/page.tsx）

**改进项**：
1. **移动端顶部操作栏**
   - 添加 `backdrop-blur-md bg-background/90 shadow-sm`
   - 按钮减小为 `px-2 py-1.5 text-xs`
   - 增加 `z-20` 确保层级
2. **Tabs 移动端优化**
   - 改为横向滚动 TabsList（overflow-x-auto + flex-nowrap）
   - 移除 Select 降级方案
3. **沟通记录**
   - 自定义可展开区域（ChevronDown/ChevronUp + max-height 动画）
   - 转写文本区域添加 `bg-muted/30 rounded-lg p-3`
4. **拜访签到**
   - 状态 badge 统一为 `rounded-full`
   - 照片网格添加 gap-1.5

### 4.3 客户池/流转池（/crm/customers, /crm/customer-pool）

**改进项**：
1. **卡片交互优化**
   - 取消 Card 整体 onClick
   - 客户名称区域加 Link（增大点击热区）
   - 操作按钮移至 Card 底部固定区域
2. **空状态统一**
   - 使用 CrmEmptyState 组件
3. **筛选器标签提取**
   - 使用 ActiveFilterBar 统一组件

### 4.4 跟进任务页（/crm/follow-ups）

**改进项**：
1. **卡片操作区**
   - 移动端按钮改为 `size="default"`（h-10）
   - "完成"按钮添加 `min-w-[88px]`
2. **逾期任务视觉强化**
   - 添加左侧红色色条 `border-l-4 border-red-500`
   - 截止时间使用 `font-medium`

### 4.5 关系网络页（/crm/relations）

**改进项**：
1. **移动端箭头指示**
   - 用带色标签替代纯箭头：`介绍了`（绿色）/`被介绍`（蓝色）
   - 增加关系方向图标

### 4.6 关系图谱页（/crm/graph）

**改进项**：
1. **搜索下拉优化**
   - 添加 `useClickOutside` 自动关闭
   - 搜索结果添加 hover:bg-muted

---

## 5. 移动端适配策略

### 5.1 断点定义

- 移动端：`< 768px`（使用 `md:` 前缀）
- 平板：`768px - 1024px`
- 桌面：`> 1024px`

### 5.2 触控规范

| 元素 | 最小尺寸 | 间距 |
|------|----------|------|
| 按钮 | 44×44px | ≥ 8px |
| 卡片点击区 | 全宽 | ≥ 12px 间距 |
| 输入框 | h-10（40px） | ≥ 8px |
| Tab 项 | h-10（40px） | ≥ 4px |

### 5.3 安全区域

- 底部安全区：`pb-[calc(env(safe-area-inset-bottom)+1rem)]`
- 顶部状态栏：已有处理

---

## 6. 实施计划

### Phase 1：高优先级（核心体验）
1. [ ] CRM 主页快捷导航按钮重构
2. [ ] 客户详情页移动端顶部栏优化
3. [ ] 客户详情页 Tabs 移动端改为横向滚动

### Phase 2：中优先级（一致性）
4. [ ] 统一空状态组件（CrmEmptyState）
5. [ ] 客户池/流转池卡片交互优化
6. [ ] 跟进任务页卡片操作区增大

### Phase 3：低优先级（细节打磨）
7. [ ] 沟通记录可展开区域自定义
8. [ ] 关系网络移动端箭头优化
9. [ ] 提取 ActiveFilterBar 组件
10. [ ] 关系图谱搜索下拉优化

---

## 7. 验收标准

### 7.1 移动端

- [ ] iPhone SE（375px）上所有按钮可正常点击，无重叠
- [ ] 所有触控热区 ≥ 44×44px
- [ ] 顶部操作栏滚动时始终可见且有背景
- [ ] Tabs 可横向滚动，无内容跳动

### 7.2 桌面端

- [ ] 1920px 下表格不过度拥挤（或支持列自定义）
- [ ] 所有卡片内边距统一
- [ ] 空状态有图标+文字，不简陋

### 7.3 全平台

- [ ] 无 TypeScript 错误
- [ ] ESLint 通过
- [ ] 构建成功
- [ ] 所有 Badge 样式统一

---

## 8. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/app/crm/page.tsx` | 修改 | 快捷导航按钮重构 |
| `src/app/crm/customers/[id]/page.tsx` | 修改 | 顶部栏、Tabs、沟通记录 |
| `src/app/crm/customers/page.tsx` | 修改 | 卡片交互、空状态 |
| `src/app/crm/customer-pool/page.tsx` | 修改 | 卡片交互、空状态 |
| `src/app/crm/follow-ups/page.tsx` | 修改 | 按钮热区、逾期视觉 |
| `src/app/crm/relations/page.tsx` | 修改 | 箭头指示 |
| `src/app/crm/graph/page.tsx` | 修改 | 搜索下拉 |
| `src/components/crm/badges.tsx` | 修改 | 统一 rounded-full |
| `src/components/crm/empty-state.tsx` | 新增 | 空状态组件 |
| `src/components/crm/active-filter-bar.tsx` | 新增 | 筛选标签栏组件 |
| `src/components/crm/crm-card.tsx` | 新增 | 统一卡片组件 |
| `src/hooks/use-click-outside.ts` | 新增（或复用） | 点击外部关闭 |

---

*文档版本：v1.0*
*创建日期：2026-05-10*
