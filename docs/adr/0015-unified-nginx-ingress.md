# 0015 统一入口：nginx 容器 + Cloudflare + 子域名拆分

日期：2026-09-25
状态：已接受（阶段一已上线；阶段二冻结，等待域名 ICP 备案）

## 背景

入口分裂且不可复现：

- web/CP 经主机 nginx（配置在主机手工维护，与 mihomo 面板等无关路由混居同一 vhost）；
- casdoor 由 compose 直接绑 `0.0.0.0:8000` 暴露公网，OIDC issuer 是裸 IP 地址；
- 无域名、无 TLS：PWA 安装与 Web Push 订阅要求 secure context，生产不可用；
- site（官网）落地在即，再加一个端口会更碎。

## 决策

1. **compose 内 nginx 容器为唯一对外入口**（80/443），路由配置入库 `deploy/nginx/cyber-stray.conf`，随发布流水线同步；其余服务端口一律只绑 `127.0.0.1`。
2. **子域名拆分**（域名 kleinbottle.top，Cloudflare 橙云代理，CF SSL 模式 Full (strict)）：
   - `app.` → web（CP 经 web rewrites 内部代理）
   - `auth.` → casdoor（issuer/origin 同域名，无子路径适配坑）
   - apex → site 官网
3. **证书**：主机 certbot（已装，Ubuntu timer 自动续期），webroot 模式经 nginx 容器 `/var/www/certbot` 验证；deploy-hook 重载容器 nginx。
4. **主机 nginx 让位**：改听 :8081，只保留与本项目无关的面板路由；80/443 完整交给容器。
5. **真实客户端 IP**：nginx 从 `CF-Connecting-IP` 还原（`real_ip_header`）。NOTE：在防火墙限制 80/443 仅 CF IP 段之前，直连源站可伪造该头，仅影响日志。

## 冻结点（阶段二）

京东云对未备案域名的 :80/:443 按 Host 拦截（403 → illegalitydomain.jcloud.com），CF 回源与 ACME HTTP-01 验证均不通。以下动作冻结至备案通过，且必须**同一窗口原子完成**（issuer 不一致会直接打断 OIDC 登录链路，casdoor 端口收口先行会让 CP→casdoor 不可达——当日实测验证过）：

1. certbot 签发三域名证书，nginx conf 切阶段二（443 + HTTP 跳转）；
2. `.env`：`CASDOOR_ISSUER` / `CASDOOR_REDIRECT_URI` / `CP_WEB_ORIGIN` 切 https 域名；
3. casdoor 管理界面更新应用 redirectUris；
4. `deploy/casdoor/app.conf`：`origin` 切 https 域名、`runmode` 改 prod（源 IP 随之从仓库当前版本消失）；
5. compose：casdoor 收回 `127.0.0.1:8000`；
6. container-update.sh 健康门补 https 端点检查。

## 后果

- 入口配置可复现：重建机器 = 拉镜像 + 同步 deploy/ + 签证书，主机手工层只剩面板路由。
- 阶段一期间公网访问形态不变（`http://<源IP>/` 经容器 nginx default_server），casdoor 仍暂公网 :8000。
- 被否决的替代：Caddy（自动 TLS 更省事，但 site 容器已用 nginx，技术栈统一优先）；casdoor 子路径 `/casdoor/`（子路径 origin 适配坑多）；Cloudflare Tunnel（规避备案，合规风险自担）。
