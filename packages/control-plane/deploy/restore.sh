#!/usr/bin/env bash
# ============================================================
# cyber-stray 恢复（S12，#79）——从 backup.sh 产物完整还原
#
# 恢复 = 停机 → 解包 → 重启。控制面与 Casdoor 都是 SQLite 单文件 +
# 目录，tar 恢复即完整还原（无状态漂移）。
#
# 用法（root）:
#   ./restore.sh /backup/cyber-stray/cyber-stray-YYYYMMDD-HHMMSS.tar.gz
#   ./restore.sh <tar> --no-systemd   # 演练/容器：跳过 systemctl
#
# 演练纪律（README §恢复演练）: 每次部署变更后跑一次"备份→破坏→恢复→
# 校验"，确保备份真实可恢复。
# ============================================================
set -euo pipefail

TARBALL=${1:-}
NO_SYSTEMD=${2:-}
APP_DIR=${APP_DIR:-/opt/cyber-stray}
CASDOOR_DIR=${CASDOOR_DIR:-/opt/casdoor}
[ -n "$TARBALL" ] || { echo "用法: $0 <backup.tar.gz> [--no-systemd]"; exit 2; }
[ -f "$TARBALL" ] || { echo "备份文件不存在: $TARBALL"; exit 1; }

echo "==> [1/3] 停机"
if [ "$NO_SYSTEMD" = "--no-systemd" ]; then
  echo "    (演练模式：跳过 systemctl)"
else
  systemctl stop control-plane web casdoor 2>/dev/null || true
fi

echo "==> [2/3] 解包（先解到临时目录；替换采用"旧数据让位+新数据迁入"，
#   mv 失败时旧数据仍在——避免 rm-then-mv 在跨文件系统 mv 失败时丢唯一副本）"
TMP=$(mktemp -d)
tar -xzf "$TARBALL" -C "$TMP"

# 新备份布局（backup.sh v2）：app/data（租户 markdown + master.key）+
# db/{control,casdoor}.db（SQLite 事务快照）+ casdoor/conf（可选）
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

echo "==> [3/3] 重启"
if [ "$NO_SYSTEMD" = "--no-systemd" ]; then
  echo "    (演练模式：跳过 systemctl)"
else
  systemctl start casdoor 2>/dev/null || true   # Casdoor 可选组件：未装则跳过
  systemctl start control-plane web
fi

echo "恢复完成。校验:"
echo "  curl http://localhost:8787/healthz"
echo "  systemctl status control-plane web casdoor"
