# JD 云服务器 Cyber-Stray 生产部署调研

> **Date:** 2026-08-25
> **Target:** 生产服务器（JD 云，IP / 主机名已脱敏），ssh 别名 `<server>`，root 用户
> **Method:** 全程只读调研（`ps` / `systemctl cat` / `ss` / `journalctl` / `ls` / `cat`），未修改任何配置、文件或进程
> **Sources:** 所有事实均来自实际执行的远程命令输出；命令原文见文末"调研命令清单"
> **Sanitized:** 服务器 IP、主机名、GitHub 账号等身份信息已脱敏为占位符（`<server>`、`<owner>`），命令清单中的 `ssh <server>` 需替换为本地 ssh 别名

---

## 1. 服务器概况

- 主机名：（已脱敏，不记录原值）
- OS：Ubuntu 24.04，kernel 6.8（任务前置事实 + `ps` 输出中 systemd/chrony 等 24.04 特征）
- 上游仓库：`git@github.com:<owner>/cyber-stray.git`（`git -C /opt/cyber-stray remote -v`）
- 出网走本机 mihomo 代理 `http://127.0.0.1:7890`（control-plane/web 的 systemd drop-in `proxy.conf` 注入 HTTP(S)\_PROXY；另有长期运行的 `nc -X 5 -x 127.0.0.1:7890 github.com 22` 用于 git fetch）

## 2. 部署总览

| 服务                                                                 | 类型                                            | 端口                                          | Cyber-Stray?                | 依据                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| control-plane.service                                                | systemd (bun)                                   | :8787                                         | ✅ 核心                     | `systemctl cat control-plane.service`；`ss -tlnp` 显示 bun pid 1322051 监听 8787                                              |
| web.service                                                          | systemd (node, Next.js standalone)              | 127.0.0.1:3000                                | ✅ 核心                     | `systemctl cat web.service`；`ss -tlnp` next-server pid 1322058 监听 127.0.0.1:3000                                           |
| nginx                                                                | systemd，反代 80 → 127.0.0.1:3000               | :80                                           | ✅ 为 c-s 服务              | `/etc/nginx/sites-enabled/cyber-stray`                                                                                        |
| GitHub Actions self-hosted runner（unit 名含仓库与主机名，已脱敏）   | systemd，用户 `cyberst+`（/opt/actions-runner） | 无监听                                        | ✅ CI/CD，部署 c-s          | unit 文件名与 Description                                                                                                     |
| casdoor.service                                                      | 原生二进制 /opt/casdoor/casdoor                 | \*:8000                                       | ✅ c-s 依赖的 OIDC provider | unit Description "Casdoor - OIDC provider for cyber…"；`.env` 含 CASDOOR\_\* 变量；control-plane unit `Wants=casdoor.service` |
| docker 容器 ×8                                                       | docker                                          | 5432/8001/3001/8080/7890-7891/9090/5060/41728 | ❌ 无关                     | `docker ps`（见 §4）                                                                                                          |
| jcloud 系（jdcloudservice、jcs-agent-core、jdog_service、ifritd）    | systemd                                         | 127.0.0.1:1234 (ifrit-agent)                  | ❌ JD 云平台自带            | 进程路径 /usr/local/share/jcloud/\*                                                                                           |
| sshd / chrony / rsyslog / cron / containerd / docker / systemd-\* 等 | 系统/基础设施                                   | 22 等                                         | ❌ 无关                     | 标准 Ubuntu 服务                                                                                                              |

## 3. Cyber-Stray 部署细节

### 3.1 代码位置与版本

- 代码目录：`/opt/cyber-stray`（pnpm monorepo 根，含 packages/agent、packages/control-plane、packages/web 等）（`ls -la /opt/cyber-stray`）
- 版本：`main` 分支，HEAD = `5c6a0d2 2026-08-25 18:55:52 +0800 fix: 表情包管线生图前缺 mkdir（产机 #133 暴露 ENOENT）`，与 origin/main 同步（`git -C /opt/cyber-stray log -1` / `status -sb`；唯一未跟踪文件是 `.env.bak.20260825-2` 备份）

### 3.2 启动方式：systemd

**control-plane**（长驻主进程；agent 不再单独常驻，而是由 CP 按调度 spawn 短命 worker 子进程——unit 注释明确写了这一进程模型）：

```ini
# /etc/systemd/system/control-plane.service（节选全文要点）
WorkingDirectory=/opt/cyber-stray
ExecStart=/usr/local/bin/bun run packages/control-plane/src/index.ts
Restart=always
RestartSec=5
KillMode=control-group        # CP 退出时收口全部在飞 worker，防孤儿写租户 state.json
KillSignal=SIGTERM
TimeoutStopSec=30
MemoryHigh=2G
MemoryMax=3G
EnvironmentFile=/opt/cyber-stray/.env
# drop-in: control-plane.service.d/proxy.conf
Environment=HTTPS_PROXY=http://127.0.0.1:7890
Environment=HTTP_PROXY=http://127.0.0.1:7890
Environment=NO_PROXY=127.0.0.1,localhost
```

（`systemctl cat control-plane.service`）

**web**：

```ini
# /etc/systemd/system/web.service（要点）
WorkingDirectory=/opt/cyber-stray-web
ExecStart=/usr/bin/node app/packages/web/server.js   # CI 构建的 Next.js standalone 产物解包至此
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
Restart=always / RestartSec=5 / MemoryMax=1.5G
After=network.target control-plane.service
```

web 是**零构建**部署：CI 打包 `web-standalone.tar.gz` 解到 `/opt/cyber-stray-web/app/packages/web/server.js`（unit 注释 + `ls /opt/cyber-stray-web`）。运行中的 next-server 为 v16.2.4（`ps` cmdline）。

两服务当前均 active（`systemctl is-active web control-plane` → active/active），均 `WantedBy=multi-user.target`。

**GitHub Actions runner**：`actions.runner.*.service`（原 unit 名含仓库 owner 与主机名，已脱敏），User=cyberstray，ExecStart=/opt/actions-runner/runsvc.sh —— 即产机同时是 c-s 仓库的 self-hosted CI runner（部署流水线在本机执行）。（unit 文件全文已读）

### 3.3 环境变量

来源：`EnvironmentFile=/opt/cyber-stray/.env`（权限 0600）。只列变量名，值未读取（`grep -oE '^[A-Z_]+' /opt/cyber-stray/.env`）：

CP_SESSION_SECRET, CP_MASTER_KEY, CP_DATA_DIR, CP_WEB_ORIGIN, CASDOOR_ISSUER, CASDOOR_CLIENT_ID, CASDOOR_CLIENT_SECRET, CASDOOR_REDIRECT_URI, CP_ADMIN_SUBS, LLM_MODEL, DEEPSEEK_API_KEY, TAVILY_API_KEY, EXA_API_KEY, FEISHU_WEBHOOK, LARK_APP_ID, LARK_APP_SECRET, DASHSCOPE_API_KEY, ARK_API_KEY, ZHIPU_API_KEY

推送渠道证据：LARK*APP_ID/LARK_APP_SECRET/FEISHU_WEBHOOK（飞书）；无 TELEGRAM*\* 变量名出现。

### 3.4 数据目录

`CP_DATA_DIR=/opt/cyber-stray/data`（journalctl 中 CP 启动日志确认 `dataDir=/opt/cyber-stray/data`）：

```
/opt/cyber-stray/data/
├── control.db                    # CP SQLite，118KB
├── logs/
│   ├── control-2026-08-25.jsonl  # 控制面日志
│   └── workers/                  # 每 tenant 每日一份 worker/diary 日志
└── tenants/<uuid>/               # 多租户：3 个租户目录（209efd46…、6fbaa78e…、ff225058…）
    ├── state.json / interests.json / feedback.json / wander-history.json
    ├── memory/ diary/ history/ dedup/ usage/ meme-assets/ pet-assets/
```

（`ls -laR` 各层目录）注意：`packages/agent/data/` 只有一个空的 `logs/` 目录——生产上租户数据全部收敛到 `CP_DATA_DIR`，不再用 agent 包内默认路径（对比 `ls /opt/cyber-stray/packages/agent/data/`）。

### 3.5 日志

- stdout/stderr → journald：`journalctl -u control-plane` / `-u web`
- 结构化日志落盘：`data/logs/control-*.jsonl` 与 `data/logs/workers/*.log`
- 近期 journal 观察到的现象（如实记录）：control-plane 多次被 stop 时 SIGTERM 超时 30s 后被 SIGKILL 再重启（Aug 25 18:56、19:02，`journalctl -u control-plane -n 50`）；有一次 Bun.serve idleTimeout 报错。web 正常 Ready。

### 3.6 agent 与 web 的关系

- web（Next.js standalone）只绑 `127.0.0.1:3000`，经 nginx 80 端口反代对外；nginx site 仅一个 `location / { proxy_pass http://127.0.0.1:3000; … }`（`cat /etc/nginx/sites-enabled/cyber-stray`）。
- **没有 TLS**：nginx 只 listen 80；`ls /etc/letsencrypt/live` 为空（certbot 在 /etc/cron.d 但无证书签发记录）。
- web 通过相对路径读 agent 数据的要求在多租户架构下对应为读 `CP_DATA_DIR`（control.db + tenants/\*/state.json），dashboard 与数据同在 /opt/cyber-stray 下满足相邻性。
- agent 不是独立常驻服务：ps 全量中没有任何常驻 agent 进程；worker 日志（`workers/worker-<tenant>-<date>.log`，当天 22:22–23:01 有活动）证明 agent 以 CP spawn 的短命子进程按调度运行。

### 3.7 casdoor（OIDC 依赖）

`casdoor.service`（Description "Casdoor - OIDC provider for cyber…"）跑原生二进制 `/opt/casdoor/casdoor`，监听 `*:8000`（`ss -tlnp`）；**零数据库依赖**：`conf/app.conf` 配 `driverName = sqlite`，数据为单文件 `/opt/casdoor/casdoor.db`（~950KB）+ 两份 8/20 的备份。（勘误：初版曾称"其 postgres/valkey 以容器形式跑"，系误判——`ps` 里属主显示为 `casdoor` 用户的 postgres/valkey 进程，实为 searxng-valkey 与 mapping-db-db 容器内进程在容器内 uid=999 与宿主机 `casdoor` 用户 uid 相同所致，与 casdoor 无连接关系。）control-plane unit 显式 `After=/Wants=casdoor.service`，`.env` 含 CASDOOR_ISSUER/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI。

## 4. 无关服务清单（逐个核实，非猜测）

全部为 docker 容器或云平台自带组件（依据：`docker ps --format …` + `ps -eo cmd`）
