# 科研项目管理系统

面向科研项目、客户关系、统一订单与财务工作的中文 Next.js 全栈系统。

## 主要功能

- 项目与工单管理
- 客户与 CRM 管理
- 统一订单管理
- 发票与成本管理
- AI 草稿填写与辅助录入
- 多角色权限控制

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run lint
npm run build
node .next/standalone/server.js
```

## 目录说明

- `src/app`：页面与 API
- `src/components`：共享组件
- `src/lib`：业务逻辑与工具
- `prisma`：数据库 schema 与种子数据
- `scripts`：部署与辅助脚本

## 说明

公开版已去除内部敏感配置，并将公开文案中的专有模块名称统一替换为中性表述。
