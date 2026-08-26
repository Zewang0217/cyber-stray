#!/usr/bin/env bash
# ============================================================
# container-update.sh — 生产机容器更新（#138 / ADR-0008）
# 真相源：仓库 packages/control-plane/deploy/（发布流水线每次同步本脚本 +
# compose.yaml 到 /opt/cyber-stray/deploy/ 后执行）。
#
# 用法:
#   sudo ./container-update.sh --tag <commit-sha>
#
# 流程: compose pull → up -d（重建）→ 健康门（编排 healthcheck + 端点）→
#       镜像清理（仅本项目镜像，保留在用 tag）
# 失败: 保留现场（容器停在当前状态，不自动回滚），退出非零——问题在发布时
#       暴露而非潜伏到深夜。
# 回滚: 把 compose.yaml 的 IMAGE_TAG 占位改成旧 sha，合并 main 重发（流水线
#       检测到非占位 tag 时跳过构建，只拉取部署）。
# ============================================================
set -euo pipefail

DEPLOY_DIR=/opt/cyber-stray/deploy
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-120}
TAG=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    *)
      echo "未知参数: $1（用法: container-update.sh --tag <commit-sha>）" >&2
      exit 2
      ;;
  esac
done
[ -n "$TAG" ] || { echo "缺少 --tag <commit-sha>" >&2; exit 2; }
[ -f "$DEPLOY_DIR/compose.yaml" ] || { echo "缺少 $DEPLOY_DIR/compose.yaml（先同步仓库部署目录）" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "缺失 docker" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose 插件缺失" >&2; exit 1; }

cd "$DEPLOY_DIR"
export IMAGE_TAG="$TAG"

echo "==> [1/4] 拉取镜像（IMAGE_TAG=$TAG）"
docker compose pull

echo "==> [2/4] 重建容器"
docker compose up -d --remove-orphans

echo "==> [3/4] 健康门（预算 ${HEALTH_TIMEOUT}s）"
# 编排 healthcheck：全部容器 healthy（部署完成判定的客观标准）
deadline=$((SECONDS + HEALTH_TIMEOUT))
while true; do
  if docker compose ps --format '{{.Name}}' | grep -q . \
    && ! docker compose ps --format '{{.Health}}' | grep -qv healthy; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "错误: 容器未在 ${HEALTH_TIMEOUT}s 内全部 healthy（保留现场）" >&2
    docker compose ps
    exit 1
  fi
  sleep 5
done
# 端点门：控制面 healthz / web 响应 / Casdoor OIDC discovery
curl -fsS http://127.0.0.1:8787/healthz >/dev/null
curl -fsS -o /dev/null http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:8000/.well-known/openid-configuration >/dev/null
echo "    全部健康：控制面 healthz / web / Casdoor OIDC ✓"

echo "==> [4/4] 镜像清理（仅本项目镜像；保留在用 tag）"
docker image prune -f >/dev/null 2>&1 || true
for repo in ghcr.io/zewang0217/cyber-stray-app ghcr.io/zewang0217/cyber-stray-web; do
  docker images "$repo" --format '{{.Repository}}:{{.Tag}}' \
    | grep -v ":$TAG$" \
    | xargs -r -n1 docker rmi -f >/dev/null 2>&1 || true
done

echo "部署完成: IMAGE_TAG=$TAG"
echo "验证: docker compose ps; curl http://127.0.0.1:8787/healthz"
echo "备份: /opt/cyber-stray/packages/control-plane/deploy/backup.sh（数据路径不变）"
