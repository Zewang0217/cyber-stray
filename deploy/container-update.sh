#!/usr/bin/env bash
# 生产机容器更新：拉镜像 → 重建容器 → 同步 casdoor/nginx 配置 → 健康门 → 镜像清理。
# 由 deploy.yml 在同步仓库 deploy/ 到 /opt/cyber-stray/deploy/ 后调用。
#
# 用法: sudo ./container-update.sh --tag <commit-sha> [--mode https_domains|http_ip] [--public-ip <IPv4>]
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
RENDER_DIR=""
trap 'rc=$?; [ -z "${RENDER_DIR:-}" ] || rm -rf -- "$RENDER_DIR"; [ $rc -ne 0 ] && alert "[cyber-stray] 发布失败：container-update.sh 退出码 $rc，tag=${TAG:-未定}"; exit $rc' EXIT

DEPLOY_DIR=/opt/cyber-stray/deploy
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-120}
TAG=""
MODE=https_domains
PUBLIC_IP=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --public-ip)
      PUBLIC_IP="${2:-}"
      shift 2
      ;;
    *)
      echo "未知参数: $1（用法: container-update.sh --tag <commit-sha> [--mode https_domains|http_ip] [--public-ip <IPv4>]）" >&2
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

# CLI 显式选择；不从服务器的历史 compose 状态推断模式，不写 .env。
PREFLIGHT_ARGS=(--mode "$MODE")
[ -z "$PUBLIC_IP" ] || PREFLIGHT_ARGS+=(--public-ip "$PUBLIC_IP")
python3 "$DEPLOY_DIR/check-production.py" "${PREFLIGHT_ARGS[@]}"
COMPOSE=(docker compose -f "$DEPLOY_DIR/compose.yaml")
CASDOOR_STAGED=$DEPLOY_DIR/app.conf
NGINX_STAGED=$DEPLOY_DIR/cyber-stray.conf
NGINX_CONF=$DEPLOY_DIR/nginx/cyber-stray.conf
if [ "$MODE" = http_ip ]; then
  COMPOSE+=(-f "$DEPLOY_DIR/compose.http-ip.yaml")
  CASDOOR_STAGED=$DEPLOY_DIR/app.http-ip.conf
  NGINX_STAGED=$DEPLOY_DIR/cyber-stray.http-ip.conf
  NGINX_CONF=$DEPLOY_DIR/nginx-http-ip/cyber-stray.conf
fi
# 同时验证 !override 支持；旧 Compose 会明确失败，禁止忽略覆盖文件。
"${COMPOSE[@]}" config --quiet
for required in "$CASDOOR_STAGED" "$NGINX_STAGED"; do
  [ -f "$required" ] || { echo "缺少本次发布的 $MODE 配置：$required" >&2; exit 1; }
done
if [ "$MODE" = http_ip ]; then
  RENDER_DIR=$(mktemp -d "$DEPLOY_DIR/.render.XXXXXX")
  sed "s/__PUBLIC_IP__/$PUBLIC_IP/g" "$CASDOOR_STAGED" > "$RENDER_DIR/app.conf"
  sed "s/__PUBLIC_IP__/$PUBLIC_IP/g" "$NGINX_STAGED" > "$RENDER_DIR/nginx.conf"
  CASDOOR_STAGED=$RENDER_DIR/app.conf
  NGINX_STAGED=$RENDER_DIR/nginx.conf
fi

# Casdoor 首次启动前必须已有配置，否则 compose 的健康依赖会等待到失败。
CASDOOR_CONF=/opt/cyber-stray/casdoor/conf/app.conf
CASDOOR_CHANGED=0
if [ -f "$CASDOOR_STAGED" ] && ! cmp -s "$CASDOOR_STAGED" "$CASDOOR_CONF"; then
  mkdir -p /opt/cyber-stray/casdoor/conf
  cp "$CASDOOR_STAGED" "$CASDOOR_CONF"
  CASDOOR_CHANGED=1
  echo "    app.conf 有变更 → 已落位"
fi
[ -f "$CASDOOR_CONF" ] || { echo "缺少 Casdoor 配置，发布停止" >&2; exit 1; }

# 暂存位落位（root 统一收口）：服务器目录属主不可预测（deploy/ 平面部署
# 用户可写；顶层、deploy/nginx/ 等 root 属主——#306 发布 CD 两连挂皆由此），
# CI 只往 deploy/ 平面同步暂存，这里以 root 身份有变才覆盖到各生效位。
# 模式对应的 Casdoor/nginx 配置必须存在，防止沿用另一模式的旧配置。

# .env.example（键清单模板）→ 顶层
ENV_EXAMPLE_STAGED=$DEPLOY_DIR/env.example
ENV_EXAMPLE=/opt/cyber-stray/.env.example
if [ -f "$ENV_EXAMPLE_STAGED" ] && ! cmp -s "$ENV_EXAMPLE_STAGED" "$ENV_EXAMPLE"; then
  cp "$ENV_EXAMPLE_STAGED" "$ENV_EXAMPLE"
  echo "    .env.example 有变更 → 更新键清单模板"
fi

# nginx 路由配置 → deploy/nginx/（bind mount 生效位；目录可能 root 属主）
if [ -f "$NGINX_STAGED" ]; then
  mkdir -p "$(dirname "$NGINX_CONF")"
  if ! cmp -s "$NGINX_STAGED" "$NGINX_CONF"; then
    cp "$NGINX_STAGED" "$NGINX_CONF"
    echo "    nginx 暂存有变更 → 已落位 $MODE 配置"
  fi
fi

# acme-webroot（certbot HTTP-01 验证目录；首次部署可能不存在）
if [ "$MODE" = https_domains ]; then
  mkdir -p /opt/cyber-stray/acme-webroot
fi

# .env 键集校验：.env.example 列出而 .env 缺失的键显式警告——关键键真缺时
# CP 起不来，由健康门兜住
if [ -f /opt/cyber-stray/.env ] && [ -f /opt/cyber-stray/.env.example ]; then
  missing=$(comm -23 \
    <(grep -oE '^[A-Z][A-Z0-9_]*=' /opt/cyber-stray/.env.example | tr -d '=' | sort -u) \
    <(grep -oE '^[A-Z][A-Z0-9_]*=' /opt/cyber-stray/.env | tr -d '=' | sort -u))
  [ -z "$missing" ] || echo "警告: .env 缺少键（对照 .env.example）: $(echo "$missing" | tr '\n' ' ')"
fi

echo "==> [1/4] 拉取镜像（IMAGE_TAG=$TAG）"
# GHCR 偶发瞬态网络中断，重试比整场部署回滚便宜
attempt=0
until "${COMPOSE[@]}" pull; do
  attempt=$((attempt + 1))
  [ "$attempt" -ge 3 ] && { echo "错误: 连续 ${attempt} 次拉取失败" >&2; exit 1; }
  echo "    第 ${attempt} 次拉取失败，5s 后重试…" >&2
  sleep 5
done

echo "==> [2/4] 重建容器"
"${COMPOSE[@]}" up -d --remove-orphans

# casdoor 配置以仓库 deploy/casdoor/app.conf 为准（CI 平面暂存为
# deploy/app.conf）：内容有变才覆盖并重启，常规发布不打扰 IdP；重启后
# 由下方健康门验证
if [ "$CASDOOR_CHANGED" = 1 ]; then
  echo "    app.conf 有变更 → 重启 casdoor"
  "${COMPOSE[@]}" restart casdoor
fi

# nginx 路由配置（deploy/nginx → bind mount 只读挂载）：落位已在前述暂存
# 收口段完成，此处只管生效——nginx 仅 reload 时重读配置，不处理就「流水线
# 改了路由、线上不生效」。内容戳判定 + 先 nginx -t 校验再平滑 reload
# （不断连接；坏配置在校验步就失败，不进健康门）
NGINX_STAMP=/opt/cyber-stray/.nginx-conf.sha256
if [ -f "$NGINX_CONF" ]; then
  nginx_sha=$(sha256sum "$NGINX_CONF" | cut -d' ' -f1)
  if [ ! -f "$NGINX_STAMP" ] || [ "$(cat "$NGINX_STAMP" 2>/dev/null || true)" != "$nginx_sha" ]; then
    "${COMPOSE[@]}" exec -T nginx nginx -t
    "${COMPOSE[@]}" exec -T nginx nginx -s reload
    echo "$nginx_sha" > "$NGINX_STAMP"
    echo "    cyber-stray.conf 有变更 → nginx 校验通过并平滑 reload"
  fi
fi

echo "==> [3/4] 健康门（预算 ${HEALTH_TIMEOUT}s）"
deadline=$((SECONDS + HEALTH_TIMEOUT))
while true; do
  if "${COMPOSE[@]}" ps --format '{{.Name}}' | grep -q . \
    && ! "${COMPOSE[@]}" ps --format '{{.Health}}' | grep -qv healthy; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "错误: 容器未在 ${HEALTH_TIMEOUT}s 内全部 healthy（保留现场）" >&2
    "${COMPOSE[@]}" ps
    exit 1
  fi
  sleep 5
done
curl -fsS http://127.0.0.1:8787/healthz >/dev/null
curl -fsS -o /dev/null http://127.0.0.1:3000/login
# site 不占宿主机端口（曾与宿主机 3001 占用冲突）：健康检查走容器内网
"${COMPOSE[@]}" exec -T site wget -q -O /dev/null http://127.0.0.1:80/
curl -fsS http://127.0.0.1:8000/.well-known/openid-configuration >/dev/null
if [ "$MODE" = http_ip ]; then
  curl -fsS -H "Host: $PUBLIC_IP" http://127.0.0.1/login >/dev/null
  echo "    全部健康：控制面 / web / site / Casdoor OIDC / 公网 IP HTTP 入口 ✓"
else
  curl -fsS --resolve kleinbottle.top:443:127.0.0.1 https://kleinbottle.top/ >/dev/null
  curl -fsS --resolve app.kleinbottle.top:443:127.0.0.1 https://app.kleinbottle.top/login >/dev/null
  curl -fsS --resolve auth.kleinbottle.top:443:127.0.0.1 https://auth.kleinbottle.top/.well-known/openid-configuration >/dev/null
  echo "    全部健康：控制面 / web / site / Casdoor OIDC / 三域名 HTTPS ✓"
fi

echo "==> [4/4] 镜像清理（仅本项目镜像；保留在用 tag）"
docker image prune -f >/dev/null 2>&1 || true
for repo in ghcr.io/zewang0217/cyber-stray-app ghcr.io/zewang0217/cyber-stray-web ghcr.io/zewang0217/cyber-stray-site ghcr.1ms.run/zewang0217/cyber-stray-app ghcr.1ms.run/zewang0217/cyber-stray-web ghcr.1ms.run/zewang0217/cyber-stray-site; do
  docker images "$repo" --format '{{.Repository}}:{{.Tag}}' \
    | grep -v ":$TAG$" \
    | xargs -r -n1 docker rmi -f >/dev/null 2>&1 || true
done

echo "部署完成: IMAGE_TAG=$TAG MODE=$MODE"
echo "验证: ${COMPOSE[*]} ps; curl http://127.0.0.1:8787/healthz"
