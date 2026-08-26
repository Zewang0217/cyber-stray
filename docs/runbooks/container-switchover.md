# Runbook：容器化切换（#138 / ADR-0008）——产机从 systemd 裸进程迁到 compose 容器

> 目标：控制面 + web + Casdoor 从 systemd unit 切换为全栈 compose 容器；
> 产机退役 self-hosted runner 与构建职责。**数据零迁移**（bind mount 回原路径），
> 切换过程可演练、可暂停。

## 0. 前置事实

- 数据原路径：`/opt/cyber-stray/data`（控制面）、`/opt/casdoor/{conf,casdoor.db}`（Casdoor）
- 旧拓扑：`control-plane.service` / `web.service` / `casdoor.service` 三个 systemd unit
- 镜像：`ghcr.io/zewang0217/cyber-stray-{app,web}`，tag = commit sha（回滚 = 换 tag 重发）
- 编排真相源：仓库 `packages/control-plane/deploy/`（compose.yaml / container-update.sh / nginx 模板）

## 1. 产机一次性前置

```bash
# 1) docker + compose 插件（本机已有多个 compose 栈 → 通常已具备）
docker --version && docker compose version

# 2) docker 拉镜像走本机代理（GHCR 直连不通；一次性，见调研文档）
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf >/dev/null <<'EOF'
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:<代理端口>"
Environment="HTTPS_PROXY=http://127.0.0.1:<代理端口>"
Environment="NO_PROXY=localhost,127.0.0.1"
EOF
sudo systemctl daemon-reload && sudo systemctl restart docker
docker pull ghcr.io/zewang0217/cyber-stray-app:latest 2>/dev/null || true  # 连通性验证（可删）

# 3) 部署目录（发布流水线同步 compose/脚本到此）
sudo mkdir -p /opt/cyber-stray/deploy
sudo chown -R cyberstray:cyberstray /opt/cyber-stray/deploy   # SSH 部署用户可写

# 4) sudoers：放行部署脚本（最小权限，参考旧 deploy.sh 的放行先例）
## 2. 演练（可选，不碰生产数据与旧服务）

> 端口互斥 + 数据互斥：compose 与旧 systemd unit 绑定同一组回环端口
> （8787/3000/8000），且双实例并发写同一 SQLite/租户目录不安全。演练用
> 备用端口 + scratch 数据验证「镜像可拉取可运行、编排可解析、健康门机制
> 有效」；正式切换（§3）才动生产数据。

```bash
# 从仓库同步编排配置（或等发布流水线自动同步）：
scp packages/control-plane/deploy/compose.yaml \
    packages/control-plane/deploy/container-update.sh \
    cyberstray@<PROD_HOST>:/opt/cyber-stray/deploy/

# scratch 数据（演练专用；casdoor 需真实 app.conf 但用副本）
ssh cyberstray@<PROD_HOST> \
  "sudo mkdir -p /tmp/dryrun-casdoor/conf \
   && sudo cp /opt/casdoor/conf/app.conf /tmp/dryrun-casdoor/conf/ \
   && sudo touch /tmp/dryrun-casdoor/casdoor.db \
   && sudo chown -R 1000:1000 /tmp/dryrun-casdoor"

# 端口 + 数据覆盖文件（ports/volumes 列表在 override 中整体替换）
cat > /tmp/cyber-stray-dryrun.yaml <<'EOF'
services:
  control-plane:
    ports: ["127.0.0.1:18787:8787"]
    environment:
      CP_DATA_DIR: /tmp/dryrun-data
    volumes: []
  web:
    ports: ["127.0.0.1:13000:3000"]
  casdoor:
    ports: ["127.0.0.1:18000:8000"]
    volumes:
      - /tmp/dryrun-casdoor/conf:/conf
      - /tmp/dryrun-casdoor/casdoor.db:/casdoor.db
EOF

ssh cyberstray@<PROD_HOST> \
  "docker compose -p cyber-stray-dryrun \
     -f /opt/cyber-stray/deploy/compose.yaml -f /tmp/cyber-stray-dryrun.yaml up -d"
# 验证：健康门三端点（备用端口）+ 容器全部 healthy
ssh cyberstray@<PROD_HOST> \
  "curl -fsS http://127.0.0.1:18787/healthz \
   && curl -fsS http://127.0.0.1:13000/ -o /dev/null \
   && curl -fsS http://127.0.0.1:18000/.well-known/openid-configuration"
# 演练结束：docker compose -p cyber-stray-dryrun down（scratch 数据可删）
```

## 3. 正式切换（停旧 → 起容器 → 验证）

```bash
# 1) 停旧服务（数据不动：unit 只管进程）
sudo systemctl disable --now control-plane web casdoor
# 或整体卸载（保留数据）：sudo /opt/cyber-stray/packages/control-plane/deploy/deploy.sh uninstall

# 2) 起容器 + 健康门（失败保留现场、退出非零）
ssh cyberstray@<PROD_HOST> \
  "sudo -n /opt/cyber-stray/deploy/container-update.sh --tag <commit-sha>"

# 3) 验证（健康门已覆盖三端点，另做对外冒烟）
curl -fsS http://127.0.0.1:8787/healthz                    # 控制面
curl -fsSI https://<HOST>/                                 # web（经 nginx，307 → 登录页可接受）
curl -fsS https://<HOST>/casdoor/.well-known/openid-configuration   # Casdoor 经 nginx
# 登录流程 + SSE 实时流 + 一次真实游荡完成后推送（部署间隙不丢数据）
```

## 4. 清理旧 runner 与旧产物

```bash
# 1) 注销 self-hosted runner（GitHub 仓库 Settings → Actions → Runners → 移除；
#    或产机 runner 目录执行 ./svc.sh uninstall + ./config.sh remove --token <token>）
# 2) 删除 runner 工作目录（_work）与 runner 用户 systemd unit（actions.runner.*）
# 3) 删除 Casdoor 裸二进制（121MB）
sudo rm -f /opt/casdoor/casdoor /opt/casdoor/casdoor.log
# 4) 仓库源码副本可保留（backup.sh 路径 /opt/cyber-stray/... 依赖它），
#    但不再需要 node/bun/pnpm 运行时与自建依赖（勿删 .env 与 data）
# 5) 镜像清理（container-update.sh 每次部署已做；此后再执行一次兜底）
sudo docker image prune -f
df -h /
```

## 5. nginx 站点同步（WS 头 + 请求体上限）

```bash
# 模板：packages/control-plane/deploy/nginx-sslip.conf（替换 <HOST> 为实际域名）
# 注意：certbot 会在站点文件里写入证书路径——以现网站点文件为基础，
# 手工合并本次变更（map 块 + WS 头 + client_max_body_size），
# 或重装模板后重跑 certbot --nginx -d <HOST>。验证：
sudo nginx -t && sudo systemctl reload nginx
# 验证 WS 升级头（应为 101 或正常响应而非 400/426）：
curl -si -H 'Connection: Upgrade' -H 'Upgrade: websocket' https://<HOST>/api/events | head -5
```

## 6. 日常发布 / 回滚

- **发布**：功能 PR → develop；人工开 develop→main PR（描述即发布说明）→ merge。
  `deploy.yml` 自动：质量门 → 构建推送镜像（tag = sha）→ 同步编排配置 → 部署 →
  健康门通过即完成。
- **回滚**：`compose.yaml` 把 `${IMAGE_TAG:-sha}` 的占位 `sha` 改成旧 sha →
  提 develop→main PR → merge（流水线跳过构建、只拉取旧镜像部署）。
- **手动重发**：仓库 Actions → CD Deploy → Run workflow（用当前 main 的 sha）。

## 7. 故障排查

| 症状 | 排查 |
|---|---|
| 健康门失败（容器 unhealthy） | `docker compose ps`、`docker compose logs --tail 100 <svc>`；控制面 healthz 需 `.env` 完整 |
| casdoor 无法写库 | `/opt/casdoor` 属主非 uid 1000（`chown -R 1000:1000`）；db 文件被误建为目录（删目录重 `touch`） |
| docker pull 超时 | docker.service 代理 drop-in 未生效（`systemctl show docker -p Environment`） |
| 登录失败 / discovery 不通 | `.env` 的 `CASDOOR_ISSUER` 必须是对外 https 地址（经 nginx /casdoor/） |
| 部署后行为异常需退版本 | 按第 6 节回滚；SQLite 迁移单向——旧代码必须兼容新 schema（ADR-0009 约束） |
| 停机期间宠物数据半写 | 优雅停机（默认 90s 预算）后仍超时被杀的孤儿由既有 lease / DB 冷却自愈（S5） |

## 8. 验收清单（issue #138 User Stories）

- [ ] develop push 自动跑质量门；develop 不产镜像
- [ ] main merge 自动构建 + 部署；镜像带 commit sha tag
- [ ] 产机无 self-hosted runner、无构建依赖（bun/node/pnpm 可卸）
- [ ] compose / 镜像定义 / nginx 模板真相源在仓库；部署自动同步 compose
- [ ] 数据路径不变；backup.sh 照常可用
- [ ] 控制面 SIGTERM：停派发 → 等在飞收口（90s 预算）→ 退出；容器日志可见三段 shutdown 记录
- [ ] 任一容器不健康时部署失败并保留现场
- [ ] 回滚演练：改 compose tag → merge → 旧版本恢复
