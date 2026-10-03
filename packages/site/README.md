# @cyber-stray/site

官网（营销落地页），单页静态导出：`next build`（`output: "export"`）产出 `out/`，
生产由 nginx 伺服（`packages/control-plane/deploy/Dockerfile.site`），运行时无 node 进程。

- 视觉真相源：`docs/design-v3/`（像素街区世界宪法）；主题锁定「深夜霓虹」，无浅色模式。
- Hero 街区舞台的猫走 `@cyber-stray/shared/sprite` 帧表契约（与 web 街角同源）。
- `public/pet/strayboy/` 是从 `packages/web/public/pet/strayboy/` 复制的产物资产
  （真相源 = `packages/web/scripts/sprite/build_sprite.py`，重生成后两处需同步）。
- CTA 地址 = 构建期 `NEXT_PUBLIC_APP_URL`（默认 `http://127.0.0.1:3000` 即 web）。

本地：`pnpm dev:site`（端口 3002）。
