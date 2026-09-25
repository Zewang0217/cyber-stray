# syntax=docker/dockerfile:1
# 应用镜像（#138 / ADR-0008）——控制面 + agent 同镜像：
# worker 是控制面的短命子进程（bun 直跑 TS），二者不可拆。
#
# 运行时：bun 直跑 TS（无编译步骤）；依赖由 pnpm install --prod 装入仓库级
# node_modules（workspace 相对链接），整树拷入 /app 保持解析。
# 布局保持仓库相对结构 /app/packages/<name>——worker-runner 的 AGENT_CLI
# 相对路径（../../../agent/src/worker/cli.ts）依赖此布局，勿改。
#
# 注意：不用 `pnpm deploy --prod`——deploy 不携带 optionalDependencies，
# libsql 的 linux-x64 原生绑定（@libsql/linux-x64-gnu）被漏掉，生产容器
# 启动即崩（Cannot find module '@libsql/linux-x64-gnu'）。`pnpm install
# --prod` 按平台装 optional，无此问题（package.json 的 optionalDependencies
# 声明保留——install 路径正是靠它解析平台包）。
#
# 构建：仅在 main 发布流水线（deploy.yml）执行；develop 不产镜像。
FROM node:22-bookworm-slim AS builder
WORKDIR /repo
# 只拷贝清单 → 锁文件安装（利用 layer 缓存；install 需全部 importer 在册）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/control-plane/package.json packages/control-plane/
COPY packages/agent/package.json packages/agent/
COPY packages/web/package.json packages/web/
COPY packages/slides/package.json packages/slides/
# pnpm 钉定 9.x：根 package.json 的 packageManager 生效（corepack 读取）；
# pnpm 10 的 install 默认要求 inject-workspace-packages，会使本构建失败。
# --prod：镜像无构建步骤，devDeps（vitest/eslint/tsc…）不进镜像。
RUN corepack enable \
  && pnpm install --frozen-lockfile --prod --filter @cyber-stray/control-plane --filter @cyber-stray/agent
# 源码（bun 直跑 TS，无编译步骤——deploy 会把包内文件复制进产物，
# 只有清单则产物缺 src/）
COPY packages/shared ./packages/shared
COPY packages/control-plane ./packages/control-plane
COPY packages/agent ./packages/agent
# 仓库根 scripts/（pet-sheet.py：CP petgen 与 agent meme 生产依赖）
COPY scripts ./scripts

# 运行时 = node:22-bookworm-slim（#175）：agent-browser 是 node CLI，运行时需要
# node/npm；bun 从官方镜像拷入（CP/worker 仍是 bun 直跑 TS）。
# python3 + numpy/Pillow：表情包工坊与 pet-sheet.py（CP petgen/agent meme 共用）的
# 运行时依赖——裸 python3 首次调用即 ModuleNotFoundError（PR #303 review P1-3）。
# agent-browser install --with-deps：下载 Chrome for Testing 并自装运行库
# （构建期实测 doctor 全过，Chrome 落 /root/.agent-browser，运行时同为 root 可见）。
# 体积 tradeoff（#175 已评估）：chrome + 依赖 ≈ +400MB——浏览工具/表情包是生产
# 功能而非可选件，运行时依赖无法省略。
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-numpy python3-pil ca-certificates \
 && npm install -g agent-browser@0.27.0 \
 && agent-browser install --with-deps \
 && rm -rf /var/lib/apt/lists/*
# bun（CP/worker 运行时）——官方镜像单二进制，直接拷入
COPY --from=oven/bun:1-slim /usr/local/bin/bun /usr/local/bin/bun
# 仓库级 node_modules（.pnpm + workspace 相对链接）整树拷贝，链接保持有效
COPY --from=builder /repo/node_modules /app/node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/scripts ./scripts
# 数据目录由 compose bind mount 注入（CP_DATA_DIR=/data ← /opt/cyber-stray/data）
ENV CP_DATA_DIR=/data
EXPOSE 8787
CMD ["bun", "packages/control-plane/src/index.ts"]