# 0019 OSS 镜像转运 + Caddy 入口 + 同机双环境（CI/CD 重建）

日期：2026-10-13
状态：已接受（spec #408，分阶段实施中）

## 背景

- 服务器访问 GitHub 方向的跨境网络不可靠，旧 CD 以「镜像打包 → Actions 产物 → 签名 URL → 分段下载 → 发布专用 mihomo」整套工事绕行：600+ 行胶水、每次发布 13 个文件同步到服务器、`DEPLOY_MODE` 双模式配置轴（ADR-0015 的 https_domains/http_ip），发布面复杂且事故频发（#267 / #306 系列）。
- 无测试环境（push develop 无处看效果）、无自动备份、服务器上两个 mihomo（其一纯为 CD 下载服务）。
- 2026-10-13 实测（与 ADR-0015 2026-09-25 记录对照）：`*.caca.qzz.io` 走 Cloudflare 橙云代理（edge TLS + 回源）；京东云按 Host 拦截未备案域名的门禁在「直连源站伪造 Host」与「CF 回源」两条路径均未复现（连接被入口 nginx 444 丢弃而非返回拦截页）。

## 决策

1. **镜像 = 版本（沿用 ADR-0008）**：CI 构建并推送 GHCR 留档；镜像包（本次部署全部所需镜像，含 casdoor 与 caddy，+ `release.json` 清单与整包摘要）经**阿里云 OSS** 转运；服务器 ossutil 下载 → 校验 → `docker load` → `compose up --pull never`。服务器不接触 GitHub / 镜像仓库，**零文件同步**、零代理依赖；发布专用 mihomo（cd-proxy）删除。
2. **入口 = Caddy 单容器**（host 网络，配置打进入口镜像）：自动 HTTPS；**:80 与 :443 都直接伺服内容、不做 HTTP→HTTPS 跳转**（CF 橙云回源可能走 http，跳转会打死回源；ACME 验证同样从 :80 进来）；取代 ADR-0015 的 nginx 容器 + certbot + webroot 与双模式轴。IP 直访站点块保留至备案完成；域名切换 = 增删站点块。CF SSL 模式 Flexible 或 Full 均可（Full(strict) 需 CF Origin CA 证书，运维时定）。
3. **同机双环境**：prod / staging 两个 compose 项目（各自 `.env`、数据根、仅 loopback 端口）；develop push → staging（灌真实业务数据，入口 Basic Auth），main 合并 → prod（发布模型沿用 ADR-0009）。**同一份镜像两环境通用**：环境差异全部落在环境变量与入口站点块，对外地址不再构建期注入（web 对 CP 的地址 = 编排内服务名；落地页 CTA = 同源相对链接）。
4. **Casdoor 独立部署**（/srv/casdoor，独立生命周期）：prod / staging 共用一个实例与一份账号库；组织仍「一产品一组织」（ADR-0004），其下建两个应用分别充当两环境的 OIDC client（凭据与回调独立）。staging 灌数据**不含**账号库；staging 上注册写共享账号库为已知接受边界（组织级隔离留作后续）。
5. **产品入口 GitHub 式**：web 根路径按登录态分流——未登录渲染官网落地页，已登录进主页；site 包退役并入 web（独立部署物消失，构建期 `NEXT_PUBLIC_APP_URL` 注入与 URL 守卫删除）。
6. **备份自动化**：夜间任务对控制面 SQLite 一致性快照，连同租户数据目录、身份库快照打包上传 OSS（保留策略配生命周期）；恢复脚本三用——生产灾备、staging 灌数据、本地开发灌真实数据。
7. **布局**：部署根从 `/opt` 迁至 `/srv`（`/srv/cyber-stray` 业务栈 + 入口，`/srv/casdoor` 身份）；迁移只动环境变量与用户数据，其余重建。

## 被否决的替代

- 服务器直拉 GHCR（经共享 mihomo 固定节点）：实测跨境 ~0.7MB/s，单次发布镜像传输不可接受，且依赖代理节点健康。
- 服务器自建构建：2C / 3.8G 忙机，两个 Next 构建即资源枯竭。
- 保留 Actions 产物转运工事：已验证能跑，但 600+ 行胶水与专用代理正是本次要清偿的对象。

## 后果

- 发布链路收敛为「构建 → OSS → 装载 → 拉起」四步；回滚 = 同一部署入口换旧版本号（OSS 保留历史版本包）。
- 清偿清单：镜像打包/传输工具、容器更新放置引擎、nginx 双模式配置、bootstrap 引导栈、URL/证书预检、发布下载专用代理、飞书运维告警 webhook 注入链路，全部删除。
- 新增风险：CI→OSS 跨境上传是唯一未经实测的新链路（ossutil 分片重试；动工先冒烟）；OSS 资源包只抵存储容量，公网下载流量按量另计（用量小）。
- 域名路径：过渡期 `cs.caca.qzz.io` 系（Cloudflare）+ IP 直访；kleinbottle.top 备案后切根域 + `auth.` 子域（站点块、casdoor origin 与 redirectUris、`.env` 的 issuer/redirect/WebOrigin 需同一窗口改）。
