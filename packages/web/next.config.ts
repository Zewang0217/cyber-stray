import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const nextConfig: NextConfig = {
  turbopack: {
    // 必须是仓库根而不是本包目录：pnpm 把依赖实体放在仓库根的
    // node_modules/.pnpm，包内 node_modules 只是软链。root 设成本包目录时
    // Turbopack 认为依赖位于项目目录之外，拒绝编译。
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
  async rewrites() {
    // S2：认证 API 代理到控制面（同域，cookie 归浏览器看到的源）。
    // 生产同形态：Nginx 反代 /api/auth → 控制面；本地开发指向控制面 dev 端口。
    const controlPlaneOrigin =
      process.env.CP_ORIGIN ?? "http://localhost:8787";
    return [
      {
        source: "/api/auth/:path*",
        destination: `${controlPlaneOrigin}/api/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
