# 0020 入口走 Cloudflare Tunnel（持机人推翻 0015 的 Tunnel 否决）

日期：2026-10-13
状态：已废止（2026-10-27 备案通过，按「后果」条款切直连 + 真证书，隧道与临时域名同窗下线；现行入口见 deploy/README）

## 背景

- 2026-10-13 实测：京东云在 :80/:443 按 Host 头做备案门禁——已备案域名的请求放行到源站（对照 `Host: www.baidu.com` 返回 `Server: Caddy`），未备案域名静默丢弃（`cs.caca.qzz.io` 等全灭，含 Cloudflare 回源）；:443 对外另有安全组未放行问题。caddy 本身在回环侧完全正常。
- `caca.qzz.io` 暂时彻底无法关联备案；`kleinbottle.top` 备案未完成、不能解析。产品需要域名入口（OIDC 回调域名绑定、staging 验收、GitHub 式产品入口）。
- ADR-0015 曾将 Cloudflare Tunnel 归为「规避备案，合规风险自担」而否决。

## 决策

1. **cloudflared 出站隧道是唯一入站路径**（Remotely managed tunnel，token 认证）：服务器内主动外连 Cloudflare 边缘，无任何入站 HTTP 流量，备案门禁与安全组均不构成阻碍。TLS 在 CF 边缘终结。
2. **caddy 保持 ADR-0019 的形态**：隧道把流量转发到本机 `http://localhost:80`（Host 头保留），现有站点块原样命中；staging 的 Basic Auth 等一切入口逻辑不变。
3. **cloudflared 以宿主 systemd 服务运行**（官方安装包），token 保管在 root-only 文件；隧道与 Public Hostnames 的配置全部在 Cloudflare 面板（远端管理），不进发布链路、不进镜像包。
4. **合规**：持机人知悉并推翻 0015 的否决——隧道绕开的是执行层面的门禁，域名的法律义务（备案）不因隧道消失，风险由持机人承担。

## 后果

- 入站端口需求归零（无需开安全组 443）；证书运维归零（无 ACME，TLS 在边缘）。
- 域名入口的可用性 = 隧道连接的可用性：cloudflared 断线自动重连，服务挂由 systemd 拉起；排障先看 `systemctl status cloudflared`。
- kleinbottle.top 备案通过后：在同隧道加 Public Hostname 即可切流量（零源站改动）；若届时改走直连 + 真证书，按 ADR-0019 的域名 checklist 执行并回退本决策的隧道部分。
- 与 0015 的关系：入口层（nginx→caddy→tunnel）全部以本 ADR 与 0019 为准；0015 的冻结点清单作废。
