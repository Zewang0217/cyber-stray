# S12 · 部署：2C4G systemd 拓扑 + 备份纪律

单机部署（不是 Docker/K8s 起步）。控制面（API + 调度器 + 推送网关）、web
（Next.js standalone）、Casdoor（OIDC provider）各一个 systemd unit；
短命 worker 由调度器拉起、随控制面进程组收口（无独立 unit）。

## 拓扑

```
Nginx (443) ─┬─ /           → web (Next.js standalone :3000)
             └─ /api/*       → 控制面 :8787（rewrites 同域代理，cookie 归浏览器源）
控制面 :8787 ─┬─ 调度器 tick → spawn 短命 worker（bun 直跑 agent CLI，并发上限 4）
              └─ Casdoor OIDC :8000（SQLite 账号库）
```

数据落盘：
- 控制面 `data/`（`tenants/<sub>/` 记忆 markdown + `control.db` + `master.key`）
- Casdoor `/opt/casdoor/casdoor.db`（身份）
- web 无本地状态（产物可再生）

## 一键部署（产机）

```bash
# 0) 产机一次性前置
curl -fsSL https://bun.sh/install | bash        # 控制面运行时
# node ≥ 22（web standalone 运行时）
sudo git clone <repo> /opt/cyber-stray

# 1) 安装全栈（units + env 模板 + 启用）。web 产物先解包（可选 --web-tar）
sudo ./packages/control-plane/deploy/deploy.sh install \
  --web-tar /path/to/web-standalone.tar.gz    # CI artifact（缺省则 web 稍后手动部署）
# 2) 填 Casdoor 三件套（create-app.sh 输出）
sudo nano /opt/cyber-stray/.env   # CASDOOR_CLIENT_ID / SECRET / REDIRECT_URI
sudo systemctl restart control-plane
# 3) 首次配置 Casdoor OIDC 应用
sudo /opt/cyber-stray/packages/control-plane/deploy/create-app.sh --restart
```

`deploy.sh status` 查三服务状态；`uninstall` 移除 units（数据保留）。

## 三条修复纪律（#79）

1. **崩溃自恢复**——全部 `Restart=always` + `RestartSec=5`；控制面
   `KillMode=control-group`：CP 退出时整个进程组收口（无孤儿 worker 写租户
   状态），CP 重启后 lease + DB 冷却兜底（S5 既有）。
2. **构建在 CI 不在产机**——`.github/workflows/ci.yml` 每次 push 跑
   typecheck/test/lint + `next build`（standalone），产物上传 artifact。
   产机：web 解包 CI 产物（零编译）；CP/agent bun 直跑 TS（无编译步骤）；
   `pnpm install --frozen-lockfile` 只装依赖不构建。
3. **真实可恢复备份**——`backup.sh`（tar 控制面 data + Casdoor 账号库，
   保留最近 N 份）+ `restore.sh`（停机→解包→重启）。恢复演练见下。

## 备份 / 恢复

```bash
# 备份（建议 cron：0 3 * * * /opt/cyber-stray/packages/control-plane/deploy/backup.sh）
./backup.sh                    # → /backup/cyber-stray/cyber-stray-<时间戳>.tar.gz
BACKUP_KEEP=14 ./backup.sh     # 保留 14 份（默认 7）

# 恢复
sudo ./restore.sh /backup/cyber-stray/cyber-stray-20260816-214133.tar.gz
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
  secure context（HTTPS；localhost 豁免）。本拓扑 unit 内为 HTTP 回环（127.0.0.1），
  生产必须由 Nginx 终结 TLS（443 → 回环服务），手机/PWA 安装与系统推送才可用。
  `CASDOOR_REDIRECT_URI` 与 `CP_WEB_ORIGIN` 用对外 https 域名。开发机 localhost
  访问不受影响（浏览器豁免）。
- **单实例**：调度器/推送网关嵌入控制面进程，多实例部署前需 DB 级租约（S5 已知限制）。
- **Nginx TLS 终止**：unit 内为 HTTP（127.0.0.1 回环）；443 由 Nginx 反代，回调
  `CASDOOR_REDIRECT_URI` 用对外 https 域名。
- **注册邮箱验证码**：Casdoor 默认 signupItems 含邮箱验证，未配 SMTP 时注册不可
  完成——生产配 SMTP 或调整 signupItems（S2 已知限制）。
- **web rewrites 目标**：`CP_ORIGIN` 构建期注入（next.config.ts），生产构建须设
  `CP_ORIGIN=http://127.0.0.1:8787`。
