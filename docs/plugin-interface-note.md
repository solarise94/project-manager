# 插件接口说明

## 概述

插件层位于 `src/lib/plugins/`，提供两类内置插件能力：

- **timeline** — 读取项目上下文，向时间流发布插件消息
- **form-draft** — 读取输入文本/上下文，返回表单字段草稿 patch

插件只能拿到整理好的上下文对象，不直接访问数据库。form-draft 插件只返回草稿，不写库。

## 目录结构

```
src/lib/plugins/
├── types.ts          # 类型定义
├── registry.ts       # 注册表（自动加载 builtin/）
├── context.ts        # 上下文构造器
├── publish.ts        # 时间流发布通道
└── builtin/
    ├── project-digest.ts      # timeline 插件：项目快照
    └── project-smart-fill.ts  # form-draft 插件：智能填写
```

## 新增插件步骤

1. 在 `src/lib/plugins/builtin/` 新建文件
2. 实现 `TimelinePlugin` 或 `FormDraftPlugin` 接口
3. 调用 `registerPlugin()` 注册
4. 在 `src/lib/plugins/registry.ts` 底部添加 `import "./builtin/your-plugin"`

完成。不需要改业务路由或前端页面。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 返回所有已注册插件 manifest |
| POST | `/api/plugins/timeline/run` | 执行 timeline 插件 |
| POST | `/api/plugins/form-draft/run` | 执行 form-draft 插件 |

### POST /api/plugins/timeline/run

```json
{
  "pluginKey": "project.digest",
  "projectId": "...",
  "input": "可选的额外输入",
  "dryRun": false
}
```

- `dryRun=true` 只返回预览，不写时间流
- 权限：需要项目写权限，REPRESENTATIVE 禁止，已删除项目禁止

### POST /api/plugins/form-draft/run

```json
{
  "pluginKey": "project.smart-fill",
  "formKey": "project.create",
  "input": "粘贴的表格文本",
  "projectId": "可选"
}
```

- 只返回草稿 patch，不写库
- 权限：已登录用户即可，REPRESENTATIVE 也可用

## 插件契约

### PluginManifest

```typescript
interface PluginManifest {
  key: string;           // 唯一标识，如 "project.digest"
  name: string;          // 显示名称
  description: string;
  capability: "timeline" | "form-draft";
  allowedRoles?: string[];  // 为空则所有角色可用
  formKeys?: string[];      // form-draft 插件支持的表单
}
```

### TimelinePlugin

```typescript
interface TimelinePlugin {
  manifest: PluginManifest;
  execute(ctx: ProjectPluginContext, actor: PluginActor, input?: string): Promise<TimelinePluginResult>;
}
```

返回值中 `message` 不为空时，会写入 ActivityLog（type=PLUGIN_MESSAGE）。

### FormDraftPlugin

```typescript
interface FormDraftPlugin {
  manifest: PluginManifest;
  execute(input: string, actor: PluginActor, formKey: string, projectCtx?: ProjectPluginContext): Promise<FormDraftResult>;
}
```

返回 `draft.fields` 是字段 patch，前端决定是否应用。

## 时间流集成

- 插件消息存储为 `ActivityLog.type = "PLUGIN_MESSAGE"`
- metadata 包含 `pluginKey`、`pluginName`、`renderMode`、`format`
- 时间流 API 将其映射为 `kind: "plugin"`
- 前端以评论卡片样式渲染，带插件徽标

## 权限边界

- 插件不绕过原有权限体系
- timeline 插件执行前校验项目写权限
- REPRESENTATIVE 不能触发 timeline 插件
- 已删除项目禁止插件写时间流
- form-draft 只生成草稿，权限较宽

## 第二阶段 backlog

- PluginRun 表记录执行历史
- 定时插件任务
- 外部 HTTP/Webhook 型插件
- 插件独立配置项和 secret 管理
- 插件消息关联 ticket/comment
- 表单 schema 驱动
