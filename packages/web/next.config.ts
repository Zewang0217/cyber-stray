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
    // S2/S6：认证 + 数据 API 代理到控制面（同域，cookie 归浏览器看到的源）。
    // 数据 API 由控制面做鉴权与租户路由——web 是只读消费方，不持有
    // CP_SESSION_SECRET。生产同形态：Nginx 反代这些前缀 → 控制面。
    const controlPlaneOrigin =
      process.env.CP_ORIGIN ?? "http://localhost:8787";
    return [
      {
        source: "/api/auth/:path*",
        destination: `${controlPlaneOrigin}/api/auth/:path*`,
      },
      {
        source: "/api/state",
        destination: `${controlPlaneOrigin}/api/state`,
      },
      {
        source: "/api/history",
        destination: `${controlPlaneOrigin}/api/history`,
      },
      {
        source: "/api/interests",
        destination: `${controlPlaneOrigin}/api/interests`,
      },
      {
        source: "/api/interests/history",
        destination: `${controlPlaneOrigin}/api/interests/history`,
      },
      {
        source: "/api/pets/adopt",
        destination: `${controlPlaneOrigin}/api/pets/adopt`,
      },
      {
        source: "/api/pets",
        destination: `${controlPlaneOrigin}/api/pets`,
      },
      {
        source: "/api/events",
        destination: `${controlPlaneOrigin}/api/events`,
      },
      {
        source: "/api/feedback",
        destination: `${controlPlaneOrigin}/api/feedback`,
      },
      {
        source: "/api/boost",
        destination: `${controlPlaneOrigin}/api/boost`,
      },
    ];
  },
};

export default nextConfig;
