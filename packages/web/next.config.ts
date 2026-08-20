import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const nextConfig: NextConfig = {
  // S12：standalone 产物自包含（.next/standalone 含 server.js + 最小依赖树），
  // 产机只需 node 运行时 + 静态资源——构建在 CI，产机零编译
  output: "standalone",
  // #90：跨包共享性格注册表（TS 源码直接消费）
  transpilePackages: ["@cyber-stray/shared"],
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
        // #91/#93：作息/日记风格等宠物子路径设置（sleep-schedule / diary-style / diary-push）
        source: "/api/pets/:path*",
        destination: `${controlPlaneOrigin}/api/pets/:path*`,
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
      {
        source: "/api/push/:path*",
        destination: `${controlPlaneOrigin}/api/push/:path*`,
      },
      {
        source: "/api/channels/:path*",
        destination: `${controlPlaneOrigin}/api/channels/:path*`,
      },
      {
        source: "/api/plan/:path*",
        destination: `${controlPlaneOrigin}/api/plan/:path*`,
      },
      {
        source: "/api/admin/:path*",
        destination: `${controlPlaneOrigin}/api/admin/:path*`,
      },
      {
        source: "/api/evolution/:path*",
        destination: `${controlPlaneOrigin}/api/evolution/:path*`,
      },
      {
        source: "/api/footprint/:path*",
        destination: `${controlPlaneOrigin}/api/footprint/:path*`,
      },
      {
        // #92：日记（睡前任务生成；列表/单篇）
        source: "/api/diary/:path*",
        destination: `${controlPlaneOrigin}/api/diary/:path*`,
      },
      {
        // #93：梦境（与日记同刻预生成；列表/单篇）
        source: "/api/dream/:path*",
        destination: `${controlPlaneOrigin}/api/dream/:path*`,
      },
      {
        // #97：微信通道（扫码即用公开绑定页 + 登录态状态查询）
        source: "/api/wechat/:path*",
        destination: `${controlPlaneOrigin}/api/wechat/:path*`,
      },
      {
        // #94：宠物 IP 定制（spec 提交/概念图/确认/素材，Pro/BYOK 专属）
        source: "/api/petgen/:path*",
        destination: `${controlPlaneOrigin}/api/petgen/:path*`,
      },
      {
        // #95：宠物素材消费（manifest 按租户 + 鉴权素材服务；web 只读消费方）
        source: "/api/pet/manifest",
        destination: `${controlPlaneOrigin}/api/pet/manifest`,
      },
      {
        source: "/api/pet-assets/:path*",
        destination: `${controlPlaneOrigin}/api/pet-assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
