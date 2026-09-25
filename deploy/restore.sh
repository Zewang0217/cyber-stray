#!/usr/bin/env bash
# cyber-stray 恢复：从 backup.sh 的产物完整还原（停容器 → 解包替换 → 起容器）。
# 控制面与 Casdoor 都是 SQLite 单文件 + 目录，解包替换即完整还原。
#
# 用法（root）:
#   ./restore.sh /backup/cyber-stray/cyber-stray-<时间戳>.tar.gz
#   ./restore.sh <tar> --no-restart    # 演练模式：不动容器（沙箱/无 docker 环境）
set -euo pipefail

TARBALL=${1:-}
SKIP_RESTART=${2:-}
APP_DIR=${APP_DIR:-/opt/cyber-stray}
CASDOOR_DIR=${CASDOOR_DIR:-/opt/cyber-stray/casdoor}
COMPOSE_FILE="$APP_DIR/deploy/compose.yaml"
[ -n "$TARBALL" ] || { echo "用法: $0 <backup.tar.gz> [--no-restart]"; exit 2; }
[ -f "$TARBALL" ] || { echo "备份文件不存在: $TARBALL"; exit 1; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "==> [1/3] 停容器"
if [ "$SKIP_RESTART" = "--no-restart" ]; then
  echo "    (演练模式：跳过容器操作)"
else
  [ -f "$COMPOSE_FILE" ] || { echo "缺少 $COMPOSE_FILE"; exit 1; }
  compose stop
fi

echo "==> [2/3] 解包替换"
# 备份布局：app/data（租户 markdown + master.key）+ db/{control,casdoor}.db
# （SQLite 事务快照）+ casdoor/conf（可选）
TMP=$(mktemp -d)
tar -xzf "$TARBALL" -C "$TMP"

# 替换采用「旧数据先 mv 让位，新数据迁入成功后再删」——跨文件系统 mv 失败时
# 旧副本仍在，避免 rm-then-mv 丢唯一数据
if [ -d "$TMP/app/data" ]; then
  rm -rf "$APP_DIR/data.old"
  [ -d "$APP_DIR/data" ] && mv "$APP_DIR/data" "$APP_DIR/data.old"
  mkdir -p "$APP_DIR"
  mv "$TMP/app/data" "$APP_DIR/data" || { mv "$APP_DIR/data.old" "$APP_DIR/data" 2>/dev/null || true; exit 1; }
  rm -rf "$APP_DIR/data.old"
else
  echo "警告: 备份未含控制面 data（app/data 缺失）——跳过"
fi

if [ -f "$TMP/db/control.db" ]; then
  mv "$TMP/db/control.db" "$APP_DIR/data/control.db" 2>/dev/null || \
    { mkdir -p "$APP_DIR/data"; mv "$TMP/db/control.db" "$APP_DIR/data/control.db"; }
fi

if [ -f "$TMP/db/casdoor.db" ]; then
  rm -rf "$CASDOOR_DIR/casdoor.old"
  [ -f "$CASDOOR_DIR/casdoor.db" ] && mv "$CASDOOR_DIR/casdoor.db" "$CASDOOR_DIR/casdoor.old"
  mkdir -p "$CASDOOR_DIR"
  mv "$TMP/db/casdoor.db" "$CASDOOR_DIR/casdoor.db" || { mv "$CASDOOR_DIR/casdoor.old" "$CASDOOR_DIR/casdoor.db" 2>/dev/null || true; exit 1; }
  rm -rf "$CASDOOR_DIR/casdoor.old"
  [ -d "$TMP/casdoor/conf" ] && { rm -rf "$CASDOOR_DIR/conf"; mv "$TMP/casdoor/conf" "$CASDOOR_DIR/conf"; }
else
  echo "警告: 备份未含 Casdoor 账号库——跳过"
fi
rm -rf "$TMP"

echo "==> [3/3] 起容器"
if [ "$SKIP_RESTART" = "--no-restart" ]; then
  echo "    (演练模式：跳过容器操作)"
else
  compose start
fi

echo "恢复完成。校验:"
echo "  curl http://localhost:8787/healthz"
echo "  docker compose -f $COMPOSE_FILE ps"
