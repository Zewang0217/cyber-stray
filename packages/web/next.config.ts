import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const nextConfig: NextConfig = {
  turbopack: {
    // 必须是仓库根而不是本包目录：pnpm 把依赖实体放在仓库根的
    // node_modules/.pnpm，包内 node_modules 只是软链。root 设成本包目录时
    // Turbopack 认为依赖位于项目目录之外，拒绝编译。
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};

export default nextConfig;
