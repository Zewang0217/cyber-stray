# 部署

单机容器化部署（ADR-0008）：compose 编排四个容器——control-plane（控制面 +
agent，worker 是短命子进程）、web（Next.js standalone）、site（官网静态镜像，
nginx 纯静态）、Casdoor（官方镜像 + SQLite）。构建在 GitHub Actions 完成，
生产机只拉镜像、跑容器。

本目录是部署配置的权威版本，发布流水线每次同步到生产机 `/opt/cyber-stray/deploy/`。

| 文件 | 作用 |
|---|---|
| `compose.yaml` | 全栈编排（镜像 tag `${IMAGE_TAG:-sha}`） |
| `Dockerfile.app` / `Dockerfile.web` | 应用镜像 / web 镜像 |
| `Dockerfile.site` / `nginx.site.conf` | 官网镜像（静态导出 + nginx）/ 容器内 nginx；CTA 地址构建期 `NEXT_PUBLIC_APP_URL` 注入（流水线取仓库 variable `APP_URL`） |
| `container-update.sh` | 生产机更新：拉镜像 → 起容器 → 同步 casdoor 配置 → 健康门 → 镜像清理 |
| `casdoor/app.conf` | Casdoor 服务配置；`container-update.sh` 比对内容，有变化才覆盖到 `/opt/cyber-stray/casdoor/conf/` 并重启 |
| `backup.sh` / `restore.sh` | 备份 / 恢复 |
| `nginx-sslip.conf` | Nginx + sslip.io + TLS 参考模板（生产机实际 nginx 配置在主机维护） |

Casdoor 的密钥类内容不入库：OIDC 应用（client id/secret）在 Casdoor 管理界面
创建后写入 `/opt/cyber-stray/.env`；`conf/init_data.json`（首启种子，含
clientSecret）仅在重建全新环境时手工放置。

## 数据布局

单根 `/opt/cyber-stray`（备份脚本同根覆盖）：

- `data/`：控制面（`tenants/<sub>/` 记忆 markdown、`control.db`、`master.key`、logs）
- `casdoor/`：`conf/` + `casdoor.db`（目录属主须 1000:1000，原因见 compose 注释）
- web / site 无本地状态

## 发布 / 回滚

- 发布：develop → main 的 PR，merge 触发 `deploy.yml`：质量门 → 构建推送镜像
  （tag = commit sha）→ 同步本目录到生产机 → `container-update.sh`。
- 回滚：把 `compose.yaml` 的 `IMAGE_TAG:-sha` 占位改成旧 sha，合并 main 重发；
  流水线检测到非占位 tag 时跳过构建、只拉取部署。
- 部署成功判定：容器 healthcheck 全绿 + 控制面 `/healthz`、web、Casdoor OIDC
  discovery 三个端点可达；任一不健康则部署失败并保留现场。

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

- PWA / Web Push 需要 HTTPS 安全上下文：生产须由 nginx 终结 TLS（443 → 回环
  容器端口），`CASDOOR_REDIRECT_URI` / `CP_WEB_ORIGIN` 用对外 https 域名。
- `CASDOOR_ISSUER` 必须是浏览器可直达的对外地址：authorize 端点由浏览器访问，
  控制面容器内的 discovery 请求经宿主 nginx 转发，均不能用容器内网地址。
- 单实例：调度器 / 推送网关内嵌控制面进程，多实例前需 DB 级租约。
- SQLite 迁移单向：schema 变更必须兼容「旧代码读新 schema」，坏版本才能直接
  换 tag 回退（ADR-0009）。
- Casdoor 默认 signupItems 含邮箱验证：未配 SMTP 时注册无法完成，生产配 SMTP
  或调整 signupItems。
- `CP_ORIGIN` 构建期注入 web 镜像（默认 compose 网络内 `http://control-plane:8787`）。
- site 对外路由：官网容器只绑 `127.0.0.1:3001`，营销域由宿主机 nginx 加 server
  块反代（TLS 同 certbot 流程，模板见 `nginx-sslip.conf` 尾部注释）。官网 CTA
  构建期烘焙，改 `vars.APP_URL` 后需重发一次才生效。
