# Project Manage

科研项目管理系统，使用 Next.js standalone 方式部署。

## 本地开发

安装依赖后运行：

```bash
npm run dev
```

默认读取仓库根目录 `.env` 中的 `DATABASE_URL`。当前约定是开发环境直接使用仓库内的开发库。
实际 SQLite 路径由 Prisma 按 [schema.prisma](/home/solarise/project-manage/prisma/schema.prisma) 所在目录解析，因此默认开发库是 `/home/solarise/project-manage/prisma/dev.db`。

## 生产启动规则

这个项目不是用 `next start` 做正式运行验证。

- 构建产物验证：`node .next/standalone/server.js`
- 已部署运行目录：`node server.js`
- 标准部署入口：`./scripts/deploy-demo.sh` 或 `./scripts/deploy-prod.sh`

原因见 [AGENTS.md](./AGENTS.md)。如果有人把 standalone 项目用 `next start` 拉起来，容易出现登录页能开但认证或 API 行为异常的假故障。

## 环境和数据库分工

这套项目建议始终分成三套数据：

- 开发库：`/home/solarise/project-manage/prisma/dev.db`，只给本地开发和调试使用。
- Demo 运行库：`/home/solarise/task-manager-data/demo/dev.db`，只给 demo 服务验收使用。
- 正式运行库：`/home/solarise/task-manager-data/prod/dev.db`，只给正式对外服务使用。

不要让 demo 服务直接复用开发库，也不要让正式版复用 demo 库。这样可以避免验收数据、调试数据、线上数据互相污染。

补充说明：

- `/home/solarise/project-manage/dev.db` 不是正常开发路径。如果它存在，通常是某次人工调试时用绝对路径手动创建出来的临时文件。

## 部署脚本行为

### `scripts/deploy-demo.sh`

部署到：

- 运行目录：`/home/solarise/task-manager-demo`
- 服务名：`task-manager-demo.service`
- 监听地址：`127.0.0.1:31081`
- 访问方式：通常通过 SSH 隧道访问

### `scripts/deploy-prod.sh`

部署到：

- 运行目录：`/home/solarise/task-manager`
- 服务名：`task-manager.service`
- 监听地址：`0.0.0.0:31080`
- 外网地址：`https://task.solarise94.fun:39090`

### `scripts/deploy-remote-prod.sh`

部署到远程服务器：

- 运行目录：`/home/ubuntu/task-manager`
- 服务名：`task-manager.service`
- Next.js 监听地址：`127.0.0.1:31081`
- HTTPS 入口：远程 nginx 监听 `0.0.0.0:31080`，反代到 `127.0.0.1:31081`
- 外网地址：`https://task.solarise94.fun:31080`

### `scripts/deploy-standalone.sh`

这是 demo 和正式版共用的底层部署脚本，数据库策略非常重要：

- 运行库固定是脚本参数里的外置路径，不再放在代码运行目录里
- 如果检测到旧的 `${TARGET_DIR}/dev.db`，部署时会自动迁移到新的外置路径
- 如果运行库已经存在，重新部署不会覆盖已有数据
- 如果运行库缺失，部署会直接失败，不再静默从旧库回填
- 每次部署都会对运行库执行 `prisma db push`，用于补齐 schema
- 运行目录的 `.env` 每次会重写，但会优先保留已有运行环境里的 SMTP 配置

这意味着“重新构建/重新部署后代表信息丢失”通常不是因为脚本主动清库，更常见是下面几种情况：

- 数据创建在开发环境，但登录检查的是 demo 或正式环境
- demo 和正式环境看混了
- 运行库文件被手动删除或移动，导致下一次部署直接失败
- 某次代表创建流程因为邮件发送失败而按设计回滚

## `.env` 约定

需要区分两类 `.env`：

- 仓库根目录 `.env`：给本地开发用
- 运行目录 `.env`：给 systemd 启动的 standalone 服务用

不要把“改了仓库 `.env`”理解成“已经改了 demo 或正式版配置”。部署后的服务实际读取的是运行目录自己的 `.env`。

## 常用命令

本地开发：

```bash
npm run dev
```

本地构建：

```bash
npm run build
```

Demo 部署：

```bash
./scripts/deploy-demo.sh
```

正式版部署：

```bash
./scripts/deploy-prod.sh
```

## 排查“代表信息丢失”

优先按这个顺序看：

1. 当前登录的是开发、demo 还是正式版。
2. 当前服务实际读取的是哪个 `DATABASE_URL`。
3. 代表创建成功时，写入的是哪一个数据库文件。
4. 运行目录是否被重建过。
5. 创建代表时是否因为 SMTP 失败被回滚。

只要“写入的库”和“登录查看的库”不是同一个，就会表现成“保存了但下次没了”。
