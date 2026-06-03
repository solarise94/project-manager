# 部署后管理员更新邮件设计

## 状态

本文是 SciManage 的一版实现设计文档，不包含代码实现。

目标是用最小改动实现：

1. 远程部署成功后，自动给系统内所有 `ADMIN` 用户发送一封“版本已更新”邮件。
2. 邮件中的更新内容尽量自动生成，不要求人工维护开发日志或发布说明。
3. 通知能力不影响部署主流程，邮件失败只记日志，不阻断上线。

---

## 一、设计目标

### 1.1 要解决的问题

当前系统已经具备：

1. 远程部署脚本。
2. 运行时 SMTP 发信能力。
3. 内部定时 / 内部触发 API 模式。

但缺少一条简单的“部署成功通知”链路。

现阶段不希望引入：

1. 登录后弹窗。
2. 用户已读状态记录。
3. DevLog 与部署版本的强绑定。
4. 复杂的发布工作流。

因此本方案只做一件事：

```text
部署成功 -> 自动汇总本次 commit 更新 -> 给 ADMIN 发邮件
```

### 1.2 目标产出

第一版应支持：

1. 主线上 `31080` 部署成功后自动发邮件。
2. 第二个线上实例 `32080` 部署成功后自动发邮件。
3. 邮件标题中包含环境和当前 commit。
4. 邮件正文中包含本次部署区间内的 commit 摘要。
5. 每个部署环境独立记录“上次已部署 commit”。

### 1.3 非目标

第一版明确不做：

1. 不做登录弹窗。
2. 不做数据库级“已读 / 未读”。
3. 不强依赖 `DevLog`。
4. 不要求 AI 生成自然语言发布说明。
5. 不把通知失败视为部署失败。

---

## 二、整体方案

### 2.1 核心思路

部署脚本在本地仓库中计算：

1. 当前待部署 commit。
2. 该环境上次已部署 commit。
3. 两者之间的 `git log` 摘要。

部署成功后，脚本调用应用内一个受 token 保护的内部接口：

```text
POST /api/internal/deploy-notify/run
```

该接口负责：

1. 查找所有 `role = "ADMIN"` 的用户。
2. 使用现有 SMTP 能力逐个发信。
3. 返回发送结果。

### 2.2 为什么不在部署脚本里直接发邮件

不建议让 shell 脚本直接处理管理员邮箱和 SMTP，原因如下：

1. 管理员列表在数据库里，应用更容易查。
2. SMTP 配置已经由应用运行时 `.env` 承载。
3. 现有仓库已经有 `sendMail()` 能力，复用成本最低。
4. 内部 API 模式已经在 reminder / CRM review 中使用过，风格一致。

---

## 三、更新内容自动生成

### 3.1 数据来源

更新内容直接来自 git commit，不依赖人工录入。

第一版不做 AI 总结，直接发送 commit 列表。

### 3.2 每个环境独立保存“上次已部署 commit”

建议在每个环境的数据目录下保存一个持久化文件：

1. 主线上：
   `/home/ubuntu/task-manager-data/prod/last_deploy_commit.txt`
2. `32080` 实例：
   `/home/ubuntu/task-manager-data/32080/last_deploy_commit.txt`

该文件仅保存一个完整 SHA，例如：

```text
c1d34fc9ab1234567890....
```

### 3.3 生成规则

部署脚本中取值：

```bash
NEW_SHA="$(git rev-parse HEAD)"
NEW_SHORT="$(git rev-parse --short HEAD)"
OLD_SHA="$(remote_ssh "cat ${REMOTE_DATA_DIR}/last_deploy_commit.txt 2>/dev/null || true")"
```

生成更新内容：

1. 如果 `OLD_SHA` 存在且本地仓库中仍可解析：

```bash
git cat-file -e "${OLD_SHA}^{commit}" 2>/dev/null
git log --no-merges --pretty=format:'- %s (%h)' "${OLD_SHA}..${NEW_SHA}"
```

2. 如果 `OLD_SHA` 不存在，视为该环境首次记录部署版本，退化为最近若干条：

```bash
git log --no-merges -n 8 --pretty=format:'- %s (%h)' "${NEW_SHA}"
```

### 3.4 为什么不用“只取最后一个 commit”

因为一次部署通常不只包含一个提交。

如果只发送最后一个 commit，会丢失本次部署里实际包含的其他改动。第一版应该基于部署区间来生成摘要，而不是只基于当前 HEAD。

### 3.5 部署成功后回写

只有在 smoke test 成功之后，才写回：

```bash
echo "${NEW_SHA}" > "${REMOTE_DATA_DIR}/last_deploy_commit.txt"
```

这样可以保证：

1. 失败部署不会污染“已部署版本”。
2. 下次邮件仍然能正确计算区间。

---

## 四、内部通知接口设计

### 4.1 路由

新增内部接口：

```text
POST /api/internal/deploy-notify/run
```

建议文件位置：

```text
src/app/api/internal/deploy-notify/run/route.ts
```

### 4.2 鉴权

采用和现有内部接口一致的 Bearer token 模式。

优先级建议：

1. `DEPLOY_NOTIFY_TOKEN`
2. 回退到 `REMINDER_CRON_TOKEN`

即：

```text
DEPLOY_NOTIFY_TOKEN || REMINDER_CRON_TOKEN
```

如果最终没有 token，则返回 `500` 并记录日志。

第一版不建议在部署脚本里再单独设计一套 conf 读取链。

原因：

1. `deploy-remote-prod.sh` 已经解析出 `REMINDER_CRON_TOKEN_VALUE`。
2. 运行时 `.env` 也已写入 reminder token。
3. deploy-notify 只需要复用这条现有链即可。

因此脚本侧建议直接采用：

```bash
DEPLOY_NOTIFY_TOKEN_VALUE="${DEPLOY_NOTIFY_TOKEN:-${REMINDER_CRON_TOKEN_VALUE}}"
```

如果未来确实需要独立轮换 token，再把它提升为部署脚本中的一级配置项。

### 4.3 请求体

建议请求体如下：

```ts
{
  target: string;
  service: string;
  publicUrl: string;
  oldSha: string | null;
  newSha: string;
  newShortSha: string;
  deployedAt: string;
  deployedBy?: string;
  commitMessage: string;
  changeLog: string;
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `target` | 环境标识，如 `prod-31080` / `prod-32080` |
| `service` | systemd 服务名 |
| `publicUrl` | 对外访问地址 |
| `oldSha` | 上次已部署版本，可空 |
| `newSha` | 当前完整 SHA |
| `newShortSha` | 当前短 SHA |
| `deployedAt` | ISO 时间 |
| `deployedBy` | 可选，部署操作者或机器信息 |
| `commitMessage` | 当前 HEAD 的标题 |
| `changeLog` | 自动生成的 commit 摘要 |

### 4.4 接口行为

接口内部执行：

1. 校验 token。
2. 查询所有 `role = "ADMIN"` 的用户。
3. 对有邮箱的管理员逐个发送邮件。
4. 收集成功/失败数量。
5. 返回：

```json
{
  "ok": true,
  "admins": 3,
  "sent": 3,
  "failed": 0
}
```

---

## 五、邮件内容设计

### 5.1 标题

建议格式：

```text
【SciManage 部署更新】PROD 31080 已更新到 c1d34fc
```

或：

```text
【SciManage 部署更新】prod-32080 已更新到 c1d34fc
```

### 5.2 正文

正文建议包含：

1. 部署环境
2. 服务名
3. 访问地址
4. 上次版本
5. 当前版本
6. 当前 HEAD 标题
7. 部署时间
8. 自动生成的更新内容

示例：

```text
环境：prod-31080
服务：task-manager.service
地址：https://task.solarise94.fun:31080
上次版本：b0c4786
当前版本：c1d34fc
当前提交：fix(crm): 新建客户入口前置 + 代表表单小屏适配
部署时间：2026-06-03T13:25:29Z

本次更新：
- fix(crm): 新建客户入口前置 + 代表表单小屏适配 (c1d34fc)
- feat(crm): stage transition redesign with LEAD, ACTIVE cooldown, unified entry (b0c4786)
- feat(crm): unify customer effective representative resolution (5bb54f3)
```

### 5.3 HTML 与文本版本

建议同时提供：

1. `text`
2. `html`

原因：

1. 现有 `sendMail()` 已同时支持。
2. 某些邮箱客户端更适合纯文本。
3. HTML 可以让信息结构更清晰。

---

## 六、部署脚本接入点

### 6.1 主脚本

主要改动点在：

```text
scripts/deploy-remote-prod.sh
```

建议接入顺序：

1. build
2. DB sync
3. sync output
4. restart service
5. smoke test
6. 成功后生成通知 payload
7. 先写回 `last_deploy_commit.txt`
8. 调用 `/api/internal/deploy-notify/run`
9. 继续 timer / 其他收尾逻辑

这里建议“先写回，再通知”。

原因：

1. `last_deploy_commit.txt` 是部署状态的关键持久化信息。
2. 通知邮件是 best-effort 附加动作。
3. 如果通知成功但 SHA 写回失败，下次部署会重复统计本次 commit 区间。

这个重复成本不高，但从职责上看，状态落盘应先于附加通知完成。

### 6.2 `32080` 实例

`scripts/deploy-remote-32080.sh` 已经复用主脚本，因此不应重复实现一遍。

只需要保证：

1. `REMOTE_DATA_DIR` 指向 `/home/ubuntu/task-manager-data/32080`
2. `REMOTE_SERVICE` 等标识正确
3. 通知 payload 的 `target` / `service` / `publicUrl` 反映当前实例

其中 `publicUrl` 不应写死在主脚本里，建议通过单独变量覆盖：

```bash
DEPLOY_PUBLIC_URL
```

主线上默认值可取：

```bash
DEPLOY_PUBLIC_URL="${DEPLOY_PUBLIC_URL:-${NEXTAUTH_URL_VALUE}}"
```

而 `deploy-remote-32080.sh` 作为 wrapper，应显式覆盖：

```bash
export DEPLOY_PUBLIC_URL="https://task.solarise94.fun:32080"
```

这样第二个实例会自然继承通知逻辑，但邮件里仍能显示正确的公网地址。

### 6.3 建议的脚本变量

本地 git 信息：

```bash
DEPLOY_NEW_SHA="$(git rev-parse HEAD)"
DEPLOY_NEW_SHORT_SHA="$(git rev-parse --short HEAD)"
DEPLOY_HEAD_SUBJECT="$(git log -1 --pretty=%s)"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DEPLOYED_BY="$(whoami)@$(hostname)"
DEPLOY_PUBLIC_URL="${DEPLOY_PUBLIC_URL:-${NEXTAUTH_URL_VALUE}}"
```

远端已部署版本文件：

```bash
LAST_DEPLOY_FILE="${REMOTE_DATA_DIR}/last_deploy_commit.txt"
```

### 6.4 通知失败策略

这是第一版中最重要的行为约束之一：

```text
通知失败 != 部署失败
```

因此脚本里调用通知接口必须采用 warning 模式，而不是 `exit 1`。

建议：

```bash
if ! remote_ssh "... curl ... /api/internal/deploy-notify/run ..."; then
  echo "WARNING: deploy notification email failed"
fi
```

只有部署主链路失败才应中止。

---

## 七、运行时配置

### 7.1 最小配置

最小实现可以不新增新的 conf 读取逻辑，直接复用部署脚本已经解析好的：

```text
REMINDER_CRON_TOKEN
```

作为 deploy-notify 的内部调用 token。

### 7.2 推荐配置

如果希望和 reminder 解耦，可新增：

```text
DEPLOY_NOTIFY_TOKEN
```

部署脚本第一版建议只支持：

1. shell env `DEPLOY_NOTIFY_TOKEN`
2. fallback 已解析的 `REMINDER_CRON_TOKEN_VALUE`

也就是说，第一版不要求为 deploy-notify 额外引入新的 conf 文件。

---

## 八、失败与边界场景

### 8.1 首次部署

如果 `last_deploy_commit.txt` 不存在：

1. 不报错
2. `oldSha = null`
3. `changeLog` 取最近 8 条非 merge commit

### 8.2 旧 SHA 已不在当前本地仓库可见

例如：

1. 强制推送后旧提交丢失
2. 本地 shallow clone

此时区间日志可能失败。

处理建议：

1. 检查 `git cat-file -e "${OLD_SHA}^{commit}"` 是否存在
2. 不存在则退回最近 8 条 commit 模式

### 8.3 没有管理员邮箱

接口返回：

```json
{ "ok": true, "admins": 0, "sent": 0, "failed": 0 }
```

不应视为错误。

### 8.4 SMTP 未配置

当前 `mail.ts` 会自动回退 Ethereal。

这意味着：

1. 开发 / 测试环境下也可验证这条能力
2. 正式生产若 SMTP 缺失，邮件不会真正送达，但接口不会因缺失配置直接崩溃

是否要在生产强制要求真实 SMTP，不属于本方案范围。

---

## 九、实现建议

### 9.1 第一版建议范围

第一版只实现以下内容：

1. `POST /api/internal/deploy-notify/run`
2. 部署成功后脚本自动生成 `changeLog`
3. smoke success 后先更新 `last_deploy_commit.txt`
4. 再触发邮件

### 9.2 步骤插入位置

通知逻辑建议插在：

```text
smoke test 成功之后
timer / reminder / CRM review / lifecycle systemd 写入之前
```

原因：

1. 它属于“部署结果通知”，语义上紧跟 smoke 最合理。
2. 放在 timer 步骤前，能减少多段 post-smoke SSH 操作交织时的复杂度。
3. 这样也更容易阅读部署脚本的主流程。

### 9.3 暂不实现

以下增强项建议后续再考虑：

1. AI 将 commit list 总结成中文发布说明
2. 数据库记录部署通知历史
3. 对同一 `commit + target` 做幂等去重
4. Web 后台查看部署历史
5. 给非 `ADMIN` 角色订阅更新通知

---

## 十、给实现者的最小任务清单

1. 新增内部接口 `POST /api/internal/deploy-notify/run`
2. 复用 `sendMail()` 给全部 `ADMIN` 发信
3. 在 `deploy-remote-prod.sh` 中读取并维护 `last_deploy_commit.txt`
4. 在本地执行 `git cat-file -e` 校验 `OLD_SHA` 是否仍可达
5. 用 `git log OLD..NEW` 自动生成 `changeLog`
6. 在 smoke success 后先写回 `last_deploy_commit.txt`
7. 再调用 deploy-notify 接口
8. 通过 `DEPLOY_PUBLIC_URL` 让 `32080` wrapper 能覆盖公网地址
9. 通知失败仅打印 warning，不影响部署退出码
