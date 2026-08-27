# 部署：容器化拓扑（#138 / ADR-0008）+ 备份纪律

单机容器化部署：控制面 + agent（同镜像，worker 是短命子进程）、web
（Next.js standalone 镜像）、Casdoor（官方镜像）全栈一个 compose 编排；
产机只负责拉镜像、跑容器，不再担任构建机与 self-hosted runner。

本目录是部署编排配置的真相源：

| 文件 | 作用 |
|---|---|
| `compose.yaml` | 全栈编排（镜像 tag = `${IMAGE_TAG:-sha}`；回滚 = 占位改旧 sha 重发） |
| `Dockerfile.app` | 应用镜像（控制面 + agent，bun 直跑 TS；pnpm deploy 出 prod 依赖） |
| `Dockerfile.web` | web 镜像（Next.js standalone + node 运行时） |
| `container-update.sh` | 生产机更新：拉镜像 → 起容器 → 健康门 → 镜像清理 |
| `backup.sh` / `restore.sh` | 备份 / 恢复（数据路径不变，零迁移） |

> 旧 systemd 拓扑脚本（deploy.sh / *.service / setup-casdoor.sh / create-app.sh）
> 已随容器化退役删除（ADR-0008）；切换步骤见 `docs/runbooks/container-switchover.md`。
> 全新环境首次配置 Casdoor OIDC 应用：在 Casdoor 管理界面创建
> （`/casdoor` 登录 admin → 应用 → 添加 cyber-stray-web，client id/secret 写入
> `/opt/cyber-stray/.env`）。

## 拓扑


数据落盘（单根 `/opt/cyber-stray`，备份脚本同根覆盖）：
- 控制面 `/opt/cyber-stray/data`（`tenants/<sub>/` 记忆 markdown + `control.db` + `master.key` + logs）
- Casdoor `/opt/cyber-stray/casdoor`（`conf/` + `casdoor.db`，目录属主须 1000:1000）
- web 无本地状态（产物在镜像内）

## 发布 / 回滚

- 发布 = 人工开 develop→main PR，merge 即触发 `deploy.yml`：质量门 → 构建推送镜像
  （tag = commit sha）→ SSH 同步编排配置 → `container-update.sh`（拉镜像 + 起容器 +
  健康门）。PR 描述即发布说明（ADR-0009）。
- 回滚 = 把 `compose.yaml` 的 `IMAGE_TAG:-sha` 占位改成旧 sha，合并 main 重发——
  流水线检测到非占位 tag 时跳过构建、只拉取部署。
- 部署完成判定 = 容器 healthcheck 全绿 + 端点门（控制面 healthz / web / Casdoor
  OIDC discovery）；任一不健康部署失败并保留现场。

## 备份 / 恢复

```bash
# 备份（建议 cron：0 3 * * * /opt/cyber-stray/deploy/backup.sh）
/opt/cyber-stray/deploy/backup.sh  # → /backup/cyber-stray/cyber-stray-<时间戳>.tar.gz
BACKUP_KEEP=14 /opt/cyber-stray/deploy/backup.sh     # 保留 14 份（默认 7）

# 恢复（容器化后路径不变）
sudo /opt/cyber-stray/deploy/restore.sh /backup/cyber-stray/cyber-stray-20260816-214133.tar.gz
# 容器重读挂载文件（bind mount 目录：restore 换新文件后需重启容器）
sudo docker compose -f /opt/cyber-stray/deploy/compose.yaml restart
```

## 恢复演练记录（2026-08-16，v2 备份布局）

验证：备份 → 破坏 → 恢复 → 校验（本地沙箱 `/tmp/s12` 模拟 `/opt` 布局，`--no-systemd`；
control.db / casdoor.db 为真实 SQLite 含数据行，非占位文件）。

| 步骤 | 动作 | 结果 |
|---|---|---|
| 1 | `backup.sh`（APP_DIR/CASDOOR_DIR 指向沙箱） | tar.gz 含 `app/data`（tenants + master.key）+ `db/{control,casdoor}.db` + `casdoor/conf` |
| 2 | 删除 `data/tenants/t1` 与两个 `.db`（模拟损坏） | 数据消失 |
| 3 | `restore.sh <tar> --no-systemd` | 全部还原，路径探测兼容沙箱布局 |
| 4 | 校验（python sqlite3）：`pets` 行 `('小溜',)`、`users` 行 `('u1',)`、state.json、master.key | 与备份前一致 |
| 5 | 保留策略 `BACKUP_KEEP=2` 连备 3 次 | 仅留最近 2 份 |
| 6 | web standalone 完整树产物（含根 node_modules） | `next` 软链可解析、`/settings` 307、`/_next/static/*` 200、`/sw.js` 200 |

结论：备份真实可恢复（SQLite 事务快照路径 + 降级热拷贝路径均验证）；恢复用
"旧数据让位+新数据迁入"（mv 失败不丢在线副本）。生产恢复前建议先停机演练一次。

## 已知边界

- **PWA/Web Push 需 HTTPS 安全上下文**：Service Worker 注册与 Web Push 订阅要求
  secure context（HTTPS；localhost 豁免）。生产必须由 Nginx 终结 TLS
  （443 → 回环容器端口），手机/PWA 安装与系统推送才可用。`CASDOOR_REDIRECT_URI`
  与 `CP_WEB_ORIGIN` 用对外 https 域名。开发机 localhost 访问不受影响。
- **单实例**：调度器/推送网关嵌入控制面进程，多实例部署前需 DB 级租约（S5 已知限制）。
- **CASDOOR_ISSUER 必须是对外 https 地址**（经 nginx /casdoor/）：控制面容器内
  discovery 走 host nginx → casdoor 容器；authorize 端点是浏览器直接访问的，
  不能用 127.0.0.1 或容器内网地址。
- **优雅停机**：控制面 SIGTERM 后停调度器、等在飞游荡收口（默认 90s）再退出；
  compose `stop_grace_period: 100s` 覆盖预算，超时孤儿由既有 lease 机制自愈。
- **SQLite 迁移单向**：schema 变更必须兼容「旧代码读新 schema」，坏版本才能简单
  换 tag 回退（ADR-0009）。
- **注册邮箱验证码**：Casdoor 默认 signupItems 含邮箱验证，未配 SMTP 时注册不可
  完成——生产配 SMTP 或调整 signupItems（S2 已知限制）。
- **web rewrites 目标**：`CP_ORIGIN` 构建期注入（next.config.ts），镜像构建默认
  `http://control-plane:8787`（compose 网络内）；裸进程部署须设
  `CP_ORIGIN=http://127.0.0.1:8787`。
