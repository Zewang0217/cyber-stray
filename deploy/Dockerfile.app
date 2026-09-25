# syntax=docker/dockerfile:1
# 控制面 + agent 同镜像（ADR-0008）：agent worker 是控制面的短命子进程
# （bun 直跑 TS，无编译步骤），二者不可拆。构建仅在 main 发布流水线执行。
#
# 保持仓库相对布局 /app/packages/<name>：worker-runner 以相对路径
# （../../../agent/src/worker/cli.ts）定位 agent 入口。
# 不用 `pnpm deploy --prod`：它不携带 optionalDependencies，会漏掉 libsql 的
# linux-x64 原生绑定（@libsql/linux-x64-gnu），容器启动即崩；
# `pnpm install --prod` 按平台安装 optional，无此问题。
FROM node:22-bookworm-slim AS builder
WORKDIR /repo
# 只拷清单再安装，利用 layer 缓存；workspace install 需全部 importer 在册
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/control-plane/package.json packages/control-plane/
COPY packages/agent/package.json packages/agent/
COPY packages/web/package.json packages/web/
COPY packages/slides/package.json packages/slides/
# pnpm 钉 9.x（根 package.json 的 packageManager，corepack 读取）：pnpm 10
# 默认要求 inject-workspace-packages，会使本构建失败。--prod：镜像内无构建
# 步骤，devDeps（vitest/eslint/tsc）不进镜像
RUN corepack enable \
  && pnpm install --frozen-lockfile --prod --filter @cyber-stray/control-plane --filter @cyber-stray/agent
# 拷入源码：bun 直跑 TS，需要包内 src/
COPY packages/shared ./packages/shared
COPY packages/control-plane ./packages/control-plane
COPY packages/agent ./packages/agent
# pet-sheet.py：CP petgen 与 agent meme 的生产依赖
COPY scripts ./scripts

FROM oven/bun:1-slim
WORKDIR /app
# 仓库级 node_modules（.pnpm + workspace 相对链接）整树拷贝，链接保持有效
COPY --from=builder /repo/node_modules /app/node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/scripts ./scripts
# 数据目录由 compose bind mount 注入（/opt/cyber-stray/data → /data）
ENV CP_DATA_DIR=/data
EXPOSE 8787
CMD ["bun", "packages/control-plane/src/index.ts"]
