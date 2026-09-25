import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const nextConfig: NextConfig = {
  /* 视觉验收走真机截图：dev 指示器浮层会遮挡布局（同 web） */
  devIndicators: false,
  // 官网 = 纯静态单页：output export 产出 out/，由 nginx 伺服
  // （deploy/Dockerfile.site），运行时无 node 进程。
  output: "export",
  // 跨包共享 sprite 帧表契约（TS 源码直接消费，同 web）
  transpilePackages: ["@cyber-stray/shared"],
  turbopack: {
    // 必须是仓库根而不是本包目录：pnpm 依赖实体在仓库根 node_modules/.pnpm
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};

export default nextConfig;
