# syntax=docker/dockerfile:1
# 应用镜像（#138 / ADR-0008）——控制面 + agent 同镜像：
# worker 是控制面的短命子进程（bun 直跑 TS），二者不可拆。
#
# 运行时：bun 直跑 TS（无编译步骤）；依赖由 pnpm deploy 产出各包自包含目录
# （仅 prod 依赖，workspace 依赖实体化进 node_modules）。
# 布局保持仓库相对结构 /app/packages/<name>——worker-runner 的 AGENT_CLI
# 相对路径（../../../agent/src/worker/cli.ts）依赖此布局，勿改。
#
# 构建：仅在 main 发布流水线（deploy.yml）执行；develop 不产镜像。
FROM node:22-bookworm-slim AS builder
WORKDIR /repo
# 只拷贝清单 → 锁文件安装（利用 layer 缓存；pnpm deploy 需全部 importer 在册）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/control-plane/package.json packages/control-plane/
COPY packages/agent/package.json packages/agent/
COPY packages/web/package.json packages/web/
COPY packages/slides/package.json packages/slides/
RUN corepack enable \
  && pnpm install --frozen-lockfile --filter @cyber-stray/control-plane --filter @cyber-stray/agent
# 源码（deploy 会把包内文件复制进产物——只有清单则产物缺 src/）
COPY packages/shared ./packages/shared
COPY packages/control-plane ./packages/control-plane
COPY packages/agent ./packages/agent
# pnpm deploy：把目标包 + prod 依赖（含 workspace 依赖实体）落到独立目录。
# --offline：store 在上一步 install 已齐全，纯本地构建（不依赖 registry 可达性）。
RUN pnpm --offline --filter @cyber-stray/control-plane deploy --prod /app/packages/control-plane \
  && pnpm --offline --filter @cyber-stray/agent deploy --prod /app/packages/agent

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/packages ./packages
# 数据目录由 compose bind mount 注入（CP_DATA_DIR=/data ← /opt/cyber-stray/data）
ENV CP_DATA_DIR=/data
EXPOSE 8787
CMD ["bun", "packages/control-plane/src/index.ts"]
