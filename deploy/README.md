# 部署

单机容器化部署（ADR-0008 / ADR-0015）：compose 编排五个容器——control-plane
（控制面 + agent，worker 是短命子进程）、web（Next.js standalone）、site（官网
静态镜像）、Casdoor（官方镜像 + SQLite）、nginx（唯一对外入口）。构建在
GitHub Actions 完成，生产机只拉镜像、跑容器。

本目录是部署配置的权威版本，发布流水线每次同步到生产机 `/opt/cyber-stray/deploy/`。

| 文件 | 作用 |
|---|---|
| `compose.yaml` | 全栈编排（镜像 tag `${IMAGE_TAG:-sha}`） |
| `Dockerfile.app` / `Dockerfile.web` | 应用镜像 / web 镜像 |
| `Dockerfile.site` / `nginx.site.conf` | 官网镜像（静态导出 + nginx）/ 容器内 nginx；CTA 地址构建期 `NEXT_PUBLIC_APP_URL` 注入（流水线取仓库 variable `APP_URL`） |
| `container-update.sh` | 生产机更新：拉镜像 → 起容器 → 同步 casdoor 配置 → 健康门 → 镜像清理 |
| `casdoor/app.conf` | Casdoor 服务配置；`container-update.sh` 比对内容，有变化才覆盖到 `/opt/cyber-stray/casdoor/conf/` 并重启 |
| `backup.sh` / `restore.sh` | 备份 / 恢复 |
| `nginx/cyber-stray.conf` | 生产 HTTPS ingress：HTTP 跳转、apex 官网、app 伴侣端、auth 登录 |
| `check-production.py` | 更新前只读检查 HTTPS 配置、证书域名/信任链/有效期/密钥匹配与出站代理限制 |
| `compose.bootstrap.yaml` / `nginx-bootstrap.conf` | 首次签证书的独立 ACME 入口，不启动应用和数据库 |

Casdoor 的密钥类内容不入库：OIDC 应用（client id/secret）在 Casdoor 管理界面
创建后写入 `/opt/cyber-stray/.env`；`conf/init_data.json`（首启种子，含
clientSecret）仅在重建全新环境时手工放置。

## 运维告警 webhook

三个告警变量、三条注入路径，全部未配置 = 对应告警静默关闭（只留租户 SSE
事件 / 本地日志）：

| 变量 | 告警内容 | 注入方式 |
|---|---|---|
| `CP_OPS_ALERT_WEBHOOK_URL` | worker 连败 / 日预算耗尽 / 首推超时（CP 进程内） | compose env_file（`/opt/cyber-stray/.env`） |
| `OPS_ALERT_WEBHOOK_URL` | 发布失败（container-update.sh）/ 备份失败（backup.sh 兜底） | 脚本运行环境（CI SSH / systemd timer），sudo env_reset 会清掉——须 sudoers `env_keep` 或运行前显式注入 |
| `BACKUP_ALERT_WEBHOOK_URL` | 备份整体失败（backup.sh 专用） | `backup.env`（root:600，运行前 source） |

变量名清单以根 `.env.example` 为准（`container-update.sh` 按它做键集校验）。

## 数据布局

单根 `/opt/cyber-stray`（备份脚本同根覆盖）：

- `data/`：控制面（`tenants/<sub>/` 记忆 markdown、`control.db`、`master.key`、logs）
- `casdoor/`：`conf/` + `casdoor.db`（目录属主须 1000:1000，原因见 compose 注释）
- web / site 无本地状态

## 入口与域名（ADR-0015）

nginx 容器是唯一对外入口：`app.kleinbottle.top` → web、`auth.` → casdoor、
apex → site，经 Cloudflare 橙云（SSL 模式 Full (strict)）。主机 nginx 改听
:8081 只保留无关面板路由。**仓库已准备阶段二配置，本次未执行线上切换**。
ADR-0015 记录的备案前置条件仍有效；未准备好时 `check-production.py` 会在
复制生效配置、拉镜像和重建容器之前拒绝发布。不要绕过预检将单个配置先行上线。

备案通过后，在同一维护窗口完成：

1. 准备包含 `kleinbottle.top`、`app.kleinbottle.top`、`auth.kleinbottle.top` 的证书，路径为 `/etc/letsencrypt/live/kleinbottle.top/`。首次空环境可使用 `docker compose -f compose.bootstrap.yaml up -d` 提供 HTTP-01；已有 ingress 提供的 ACME webroot 可继续使用，不要争用 80 端口。
2. 使用 certbot webroot `/opt/cyber-stray/acme-webroot` 签发并验证证书，配置续期后 `docker compose exec -T nginx nginx -s reload` 的 deploy-hook。bootstrap 入口仅提供验证，其余请求返回 503；签发后关闭它再启动正式 ingress。
3. 将生产 `.env` 的 `CP_WEB_ORIGIN` 设为 `https://app.kleinbottle.top`，`CASDOOR_ISSUER` 设为 `https://auth.kleinbottle.top`，`CASDOOR_REDIRECT_URI` 设为 `https://app.kleinbottle.top/api/auth/callback`。
4. 在 Casdoor 管理界面同步应用 redirectUris。此动作涉及现有 IdP 数据，本次没有执行；必须与域名切换共同安排。
5. GitHub 仓库变量 `APP_URL` 配置为 `https://app.kleinbottle.top`。确认 `python3 check-production.py` 通过后再发布，脚本同步 Casdoor prod/origin、收回 8000 到 loopback、启用 TLS 和官网路由。
6. 验证真实浏览器登录、邀请领养、PWA 和 Web Push。脚本的 HTTPS 健康门只验证端点、证书和可达性，不能代替完整 OIDC 登录演练。

预检需要 Python 3 和 OpenSSL，只读取配置与证书，不连接或修改数据库。

## 内测权益与成本故障处理

`CP_PRODUCT_MODE=invite_beta` 是当前模式；新老受邀账号都按有效 Pro 权益运行，无需批量改数据库。平台日预算使用 `CP_LLM_BUDGET_PRO_YUAN`，不是向用户收费。`paid` 模式尚未接入支付，启动会明确拒绝。模型价格的单一真相源为 `packages/shared/src/pricing.ts`；未知价格在调用提供方前拒绝。

记账失败或发现账本损坏后，租户根目录会写入 `usage-accounting-block.json`，调度暂停宠物，候选与形象生成也停止后续付费调用。运维先核对提供方实际用量与 `usage/` 账本，修复缺失或损坏记录后，才可清理故障标记、重启 CP 并恢复宠物。不要仅恢复宠物状态或清标记来掩盖未知费用；本次未操作任何现有账本。

SaaS 外部浏览器 CLI 暂停开放，搜索及安全网页阅读保持可用。Bun 不得带非空的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`（大小写不限）启动；它会缓存代理配置，无法保证出站连接使用已验证的目标 IP。`NO_PROXY` 不豁免这项限制，预检会拒绝有代理的生产 `.env`，不显示代理凭据。需要代理的环境须先实现可验证的网络隔离再开放。

## 发布 / 回滚

- 发布：develop → main 的 PR，merge 触发 `deploy.yml`：质量门 → 构建推送镜像
  （tag = commit sha）→ 同步本目录到生产机 → `container-update.sh`。
- 回滚：把 `compose.yaml` 的 `IMAGE_TAG:-sha` 占位改成旧 sha，合并 main 重发；
  流水线检测到非占位 tag 时跳过构建、只拉取部署。
- 部署成功判定：容器 healthcheck 全绿 + 内部服务和三个域名的 HTTPS 端点可达；
  任一不健康则部署失败并保留现场。

## 备份 / 恢复

手动执行（无自动计划任务）：

```bash
sudo /opt/cyber-stray/deploy/backup.sh            # BACKUP_KEEP=14 覆盖保留份数
sudo /opt/cyber-stray/deploy/restore.sh /backup/cyber-stray/cyber-stray-<时间戳>.tar.gz
/opt/cyber-stray/deploy/restore.sh <tar> --no-restart   # 演练：不动容器
```

- 产物 `/backup/cyber-stray/cyber-stray-<时间戳>.tar.gz`，本地保留 7 份。
- 异地副本：配 `BACKUP_OFFSITE_{ENDPOINT,BUCKET,ACCESS_KEY,SECRET_KEY}` 后备份
  会推送 S3 兼容对象存储，异地保留 30 份（`BACKUP_OFFSITE_KEEP`）；任一缺失显式
  跳过异地，推送失败非零退出 + 飞书 webhook 告警（`BACKUP_ALERT_WEBHOOK_URL`）。
  凭据建议放 `/opt/cyber-stray/backup.env`（root:600），运行前 source 注入。
- 恢复流程已于 2026-08-16 在沙箱演练验证（备份 → 破坏 → 恢复 → SQLite 数据
  校验一致）。生产恢复前建议先停机演练。

## 已知边界

- PWA / Web Push 需要 HTTPS 安全上下文；实际环境完成上述阶段二切换后才能验收。
- `CASDOOR_ISSUER` 必须是浏览器可直达的对外地址：authorize 端点由浏览器访问，
  控制面容器内的 discovery 请求经 nginx ingress 转发，均不能用容器内网地址。
- 单实例：调度器 / 推送网关内嵌控制面进程，多实例前需 DB 级租约。
- SQLite 迁移单向：schema 变更必须兼容「旧代码读新 schema」，坏版本才能直接
  换 tag 回退（ADR-0009）。
- Casdoor 默认 signupItems 含邮箱验证：未配 SMTP 时注册无法完成，生产配 SMTP
  或调整 signupItems。
- `CP_ORIGIN` 构建期注入 web 镜像（默认 compose 网络内 `http://control-plane:8787`）。
- site 对外路由：官网容器**不占宿主机端口**，ingress nginx 通过 compose
  内网反代到 site:80，apex 已连接官网。
  官网 CTA 构建期烘焙，改 `vars.APP_URL` 后需重发一次才生效。
