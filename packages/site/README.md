# @cyber-stray/site

官网（营销落地页），单页静态导出：`next build`（`output: "export"`）产出 `out/`，
生产由 nginx 伺服（`deploy/Dockerfile.site`），运行时无 node 进程。

- 视觉真相源：`docs/design-v3/`（像素街区世界宪法）；主题锁定「深夜霓虹」，无浅色模式。
- Hero 街区舞台的猫走 `@cyber-stray/shared/sprite` 帧表契约（与 web 街角同源）。
- `public/pet/strayboy/` 是从 `packages/web/public/pet/strayboy/` 复制的产物资产
  （真相源 = `packages/web/scripts/sprite/build_sprite.py`，重生成后两处需同步）。
- 已有账号入口 = 构建期 `NEXT_PUBLIC_APP_URL`，生产构建必须显式提供；镜像默认要求正式 HTTPS 应用域名，显式 `DEPLOY_MODE=http_ip` 时须匹配 `http://PUBLIC_IP`。开发模式默认 `http://127.0.0.1:3000`。
- 新用户 CTA 指向 GitHub 邀请申请，管理员审核后私下提供一次性邀请链接。公开申请勿填写邮箱、密钥等隐私信息。
- 当前为免费邀请内测，权益读取 `@cyber-stray/shared/plan`，不展示收费套餐。

本地：`pnpm dev:site`（端口 3002）。

生产构建：`NEXT_PUBLIC_APP_URL=https://app.kleinbottle.top pnpm -F @cyber-stray/site build`。
