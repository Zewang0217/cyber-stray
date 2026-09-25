#!/usr/bin/env bash
# 生产机容器更新：拉镜像 → 重建容器 → 同步 casdoor 配置 → 健康门 → 镜像清理。
# 由 deploy.yml 在同步仓库 deploy/ 到 /opt/cyber-stray/deploy/ 后调用。
#
# 用法: sudo ./container-update.sh --tag <commit-sha>
# 失败: 非零退出并保留现场（不自动回滚）。
# 回滚: compose.yaml 的 IMAGE_TAG 占位改成旧 sha，合并 main 重发（跳过构建）。
set -euo pipefail

# 失败告警（#267）：飞书群机器人 webhook，OPS_ALERT_WEBHOOK_URL 未设则静默跳过；
# curl 失败不改变退出码（告警是尽力而为）。
alert() {
  [ -n "${OPS_ALERT_WEBHOOK_URL:-}" ] || return 0
  curl -fsS -m 10 -X POST -H 'content-type: application/json' \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$1\"}}" \
    "$OPS_ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}
# EXIT trap（而非 ERR）：健康门 while/if 内的 exit 1 不触发 ERR trap，
# EXIT 必到——按退出码判失败（PR #303 review P1-2）
trap 'rc=$?; [ $rc -ne 0 ] && alert "[cyber-stray] 发布失败：container-update.sh 退出码 $rc，tag=${TAG:-未定}"; exit $rc' EXIT

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
[ -f "$DEPLOY_DIR/compose.yaml" ] || { echo "缺少 $DEPLOY_DIR/compose.yaml（先同步仓库 deploy/ 目录）" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "缺失 docker" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose 插件缺失" >&2; exit 1; }

cd "$DEPLOY_DIR"
export IMAGE_TAG="$TAG"

# .env 键集校验：.env.example（随发布同步到 /opt/cyber-stray/）列出而 .env
# 缺失的键显式警告——关键键真缺时 CP 起不来，由健康门兜住
if [ -f /opt/cyber-stray/.env ] && [ -f /opt/cyber-stray/.env.example ]; then
  missing=$(comm -23 \
    <(grep -oE '^[A-Z][A-Z0-9_]*=' /opt/cyber-stray/.env.example | tr -d '=' | sort -u) \
    <(grep -oE '^[A-Z][A-Z0-9_]*=' /opt/cyber-stray/.env | tr -d '=' | sort -u))
  [ -z "$missing" ] || echo "警告: .env 缺少键（对照 .env.example）: $(echo "$missing" | tr '\n' ' ')"
fi

echo "==> [1/4] 拉取镜像（IMAGE_TAG=$TAG）"
# GHCR 偶发瞬态网络中断，重试比整场部署回滚便宜
attempt=0
until docker compose pull; do
  attempt=$((attempt + 1))
  [ "$attempt" -ge 3 ] && { echo "错误: 连续 ${attempt} 次拉取失败" >&2; exit 1; }
  echo "    第 ${attempt} 次拉取失败，5s 后重试…" >&2
  sleep 5
done

echo "==> [2/4] 重建容器"
docker compose up -d --remove-orphans

# casdoor 配置以仓库 deploy/casdoor/app.conf 为准：内容有变才覆盖并重启，
# 常规发布不打扰 IdP；重启后由下方健康门验证
CASDOOR_CONF=/opt/cyber-stray/casdoor/conf/app.conf
if ! cmp -s "$DEPLOY_DIR/casdoor/app.conf" "$CASDOOR_CONF"; then
  cp "$DEPLOY_DIR/casdoor/app.conf" "$CASDOOR_CONF"
  echo "    app.conf 有变更 → 重启 casdoor"
  docker compose restart casdoor
fi

echo "==> [3/4] 健康门（预算 ${HEALTH_TIMEOUT}s）"
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
curl -fsS http://127.0.0.1:8787/healthz >/dev/null
curl -fsS -o /dev/null http://127.0.0.1:3000/
curl -fsS -o /dev/null http://127.0.0.1:3001/
curl -fsS http://127.0.0.1:8000/.well-known/openid-configuration >/dev/null
echo "    全部健康：控制面 healthz / web / site / Casdoor OIDC ✓"

echo "==> [4/4] 镜像清理（仅本项目镜像；保留在用 tag）"
docker image prune -f >/dev/null 2>&1 || true
for repo in ghcr.io/zewang0217/cyber-stray-app ghcr.io/zewang0217/cyber-stray-web ghcr.io/zewang0217/cyber-stray-site ghcr.1ms.run/zewang0217/cyber-stray-app ghcr.1ms.run/zewang0217/cyber-stray-web ghcr.1ms.run/zewang0217/cyber-stray-site; do
  docker images "$repo" --format '{{.Repository}}:{{.Tag}}' \
    | grep -v ":$TAG$" \
    | xargs -r -n1 docker rmi -f >/dev/null 2>&1 || true
done

echo "部署完成: IMAGE_TAG=$TAG"
echo "验证: docker compose ps; curl http://127.0.0.1:8787/healthz"
