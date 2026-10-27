# 部署说明

spec #408 / [ADR-0019](../docs/adr/0019-oss-caddy-dual-env-deployment.md)。同机双环境（prod / staging）+ 独立 Casdoor + Caddy 入口；镜像包经阿里云 OSS 转运，服务器装载后 `compose up --pull never`，发布零仓库文件同步、零代理依赖。

## 组件与布局

| compose 项目 | 内容 | 服务器路径 |
|---|---|---|
| `cyber-stray-infra` | Caddy 入口（host 网络，:80/:443） | `/srv/cyber-stray/infra` |
| `cyber-stray-prod` | control-plane + web | `/srv/cyber-stray/prod` |
| `cyber-stray-staging` | control-plane + web | `/srv/cyber-stray/staging` |
| casdoor | 身份服务（独立生命周期，两环境共用） | `/srv/casdoor` |

```
/srv/cyber-stray/
  .env                  # 共享：OSS_*（bucket/endpoint/region + 服务器 RAM 凭据）
  deploy.sh  backup.sh  restore.sh
  prod/     .env  compose.yaml  data/  CURRENT_TAG
  staging/  .env  compose.yaml  data/  CURRENT_TAG
  infra/    .env  compose.yaml  caddy-data/  caddy-config/
/srv/casdoor/
  compose.yaml  casdoor/（db）  conf/app.conf
```

`compose.yaml` = 仓库对应文件（`deploy/compose.app.yaml` / `compose.infra.yaml` / `compose.casdoor.yaml`）在供给时拷入，此后属服务器状态：变更手工同步一次并在 PR 里记一笔，发布流程不再同步任何文件。

## 发布 / 回滚

- CI 触发：develop push → staging；main 合并 → prod（发布模型沿用 ADR-0009）。工作流 = 质量门 → 构建三镜像（app / web / caddy）推 GHCR 留档 → 连同 casdoor 镜像打包上传 `oss://<bucket>/releases/<sha>/` → 服务器执行 `deploy.sh`。
- 手工发布 / 回滚：`sudo /srv/cyber-stray/deploy.sh <prod|staging> <40位hex版本号>`。**回滚 = 同命令换旧版本号**（OSS 保留历史版本包）。
- `deploy.sh` 流程：参数校验（非法环境名 / 版本号明确拒绝）→ ossutil 下载 `images.tar.zst` + `release.json` → 校验整包摘要与压缩完整性 → `docker load` → infra / casdoor / 目标环境依次 `compose up -d --pull never --wait` → 冒烟（web `/login`、CP `/healthz`、入口 `/healthz`）→ 写 `CURRENT_TAG`。任一步失败非零退出、保留现场、清理临时目录；**不自动回滚**，失败告警走 GitHub 工作流失败通知。
- OSS 包契约：`releases/<sha>/images.tar.zst` + `release.json`（tag、镜像清单、整包 sha256），`deploy.sh` 逐项校验，不符即失败。

## 备份 / 恢复

- `sudo /srv/cyber-stray/backup.sh [prod|staging]`（默认 prod）：sqlite3 一致性快照（`control.db` + casdoor `casdoor.db`）连同租户数据目录打包 `tar.zst` → `oss://<bucket>/backups/<env>/backup-<UTC时间戳>.tar.zst`。夜间 cron 执行（供给时挂）。
- `sudo /srv/cyber-stray/restore.sh <prod|staging> [--from <oss对象>] [--with-accounts] [--no-restart]`：默认取最新备份；恢复 `data/`（`--with-accounts` 才动账号库）；被替换的数据移到 `data.bak-<时间戳>`。
- `restore.sh local --dir <路径>`：开发机灌真实数据（只解包、不动任何栈）。开发者凭据契约见根 `.env.local.example`（持机人分发 `.env.local`）。
- staging 灌数据 = `restore.sh staging`（**不含**账号库：身份库两环境共用，staging 用真实账号登录）。

## 环境变量契约

- 契约 = 根 `.env.example`（只列变量名与注释，无值）。服务器四处 `.env` 按需取用：共享（OSS）、prod / staging（应用 secrets，两环境独立，含各自 CASDOOR client 凭据）、infra（staging Basic Auth 等）。
- staging 入口 Basic Auth：`caddy hash-password` 生成 bcrypt 哈希，与用户名一起入 `infra/.env`。
- casdoor 管理员账号不支持环境变量注入（账号在它自己的库）；admin 密码仅作存档放 `.env.local`。

## 入口与域名

- **入站直连 + 真证书**：三个主机名的 A 记录指向服务器公网 IP，Caddy（host 网络，:80/:443）自行 ACME 签发并续期证书，:80 自动跳转 :443。Caddyfile 打进 `cyber-stray-caddy` 镜像（配置随版本走）。
- 站点：`kleinbottle.top` → prod web（GitHub 式产品入口：匿名落地页、登录后主页）、`auth.kleinbottle.top` → casdoor、`csdev.kleinbottle.top` → staging（Basic Auth）。IP 直访不再伺服内容。
- 备案窗口期曾以 `*.caca.qzz.io`（Cloudflare Tunnel，[ADR-0020](../docs/adr/0020-cloudflare-tunnel-ingress.md)）+ IP 直访过渡；kleinbottle.top 于 2026-10-27 备案通过，按 ADR-0020 后果条款切回直连，隧道与临时域名同窗下线。
- 切换 checklist（**同一窗口执行**，issuer 不一致会打断 OIDC 登录）：
  1. 京东云安全组放行 :443 入站（:80 保持，ACME HTTP-01 要用）；
  2. DNS 加三条 A 记录：`kleinbottle.top` / `auth.kleinbottle.top` / `csdev.kleinbottle.top` → `117.72.100.212`，**不开 CDN 代理**（直连是前提；隐藏源站 IP 的诉求已随隧道方案放弃）；
  3. 发布一版（新 Caddyfile 随镜像走，Caddy 启动即对三个主机名签发证书）；发布完成旧 `*.caca.qzz.io` 入口即失效，进入切换窗口；
  4. `/srv/casdoor/conf/app.conf` 的 `origin` 切 `https://auth.kleinbottle.top`，重启 casdoor；
  5. casdoor 管理界面：prod / staging 两个应用的 redirectUris 换成 `https://kleinbottle.top/api/auth/callback` / `https://csdev.kleinbottle.top/api/auth/callback`；
  6. prod / staging 的 `.env`：`CASDOOR_ISSUER=https://auth.kleinbottle.top`，`CASDOOR_REDIRECT_URI` / `CP_WEB_ORIGIN` 换对应新域名，重启两栈；
  7. 冒烟通过后拆过渡设施：`docker rm -f cyber-stray-tunnel`（隧道容器，独立 `docker run` 非 compose），Cloudflare 面板删隧道与 Public Hostnames，qzz.io 解析下掉。

## 供给 runbook（一次性）

1. 建 `/srv` 目录树与属主；sudoers：部署用户可免密 sudo 三个脚本。
2. 服务器装 ossutil 2.x、zstd、sqlite3。
3. 四处 `.env` 就位（值见 `.env.local` 交接单）；staging Basic Auth 哈希生成入 `infra/.env`。
4. compose 文件拷入；casdoor `conf/app.conf` 拷入；`/srv/casdoor/casdoor` chown 1000:1000（casdoor 容器 uid，目录挂载否则 SQLite 只读）。
5. 入口隧道（过渡期设施，2026-10-27 随域名切换下线，见「入口与域名」）：以 `docker run` 常驻容器 `cyber-stray-tunnel` 跑 cloudflared（host 网络，`tunnel --no-autoupdate run --token …`）；隧道与 Public Hostnames 在 Cloudflare 面板配置（各指 `http://localhost:80`）。
6. 挂夜间备份 cron（`backup.sh`）。
7. 数据迁移：停旧栈 → 迁 `.env` 与用户数据（`data/`、casdoor db）→ 起新栈（spec #408 实施拆分①，短暂停机窗口）。

## 排障

- 健康：`docker compose -p cyber-stray-<env> ps`；入口冒烟 `curl -skI -H 'Host: kleinbottle.top' https://127.0.0.1/healthz`。
- 域名入口不通：先在服务器回环按 Host 冒烟（上）区分「入口配置」与「网络路径」；证书签发 / 续期看 caddy 日志（ACME），网络路径查安全组 :80/:443 与 DNS 解析。
- 发布失败保留现场：按 `deploy.sh` 输出定位失败步；先回滚旧版本号恢复服务再排障。
- staging 无法访问：先确认 Basic Auth 凭据与 `infra/.env` 是否随最近一次配置变更重启过。
