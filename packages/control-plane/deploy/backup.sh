#!/usr/bin/env bash
# cyber-stray 备份（S12，#79）——真实可恢复，非摆设
#
# 覆盖三块可恢复数据：
#   1. 控制面 data/（tenants/ 租户目录、control.db、master.key）——核心
#   2. Casdoor 账号库（/opt/casdoor/casdoor.db + conf/）——身份
#   3. web 无本地状态（standalone 产物可再生），不备份
#
# SQLite 一致性（StdS12 review 修复）：control.db / casdoor.db 是运行中
# 的 SQLite——裸 tar 会抓到检查点与 WAL 交错的撕裂快照。备份前先用
# sqlite3 .backup 做事务一致拷贝（在线安全，不需停机）；未装 sqlite3 时
# 显式警告并降级热拷贝（不静默）。
#
# 产物：单 tar.gz（时间戳命名）；staging 树组装 → 一次 tar → mv 原子落位。
# 保留策略：默认保留最近 7 份（BACKUP_KEEP 覆盖）。
#
# 用法:
#   ./backup.sh
set -euo pipefail

DEST=${BACKUP_DIR:-/backup/cyber-stray}
KEEP=${BACKUP_KEEP:-7}
APP_DIR=${APP_DIR:-/opt/cyber-stray}
CASDOOR_DIR=${CASDOOR_DIR:-/opt/casdoor}
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT   # 中途失败清理暂存

[ -d "$APP_DIR/data" ] || { echo "控制面数据目录不存在: $APP_DIR/data"; exit 1; }

mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
TMP="$DEST/.cyber-stray-$STAMP.tar.gz.part"
OUT="$DEST/cyber-stray-$STAMP.tar.gz"

# 1) 事务一致 SQLite 快照 → staging/db/
mkdir -p "$STAGING/db"
for db in control casdoor; do
  src="$APP_DIR/data/$db.db"
  [ "$db" = casdoor ] && src="$CASDOOR_DIR/casdoor.db"
  if [ -f "$src" ]; then
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$src" ".backup '$STAGING/db/$db.db'"
    else
      echo "警告: 未装 sqlite3，$db.db 降级为热拷贝（非事务一致）"
      cp "$src" "$STAGING/db/$db.db"
    fi
  fi
done

# 2) 组装 staging 树：app/data（租户 markdown + master.key，排除运行中
#    SQLite 文件——已被快照取代）+ db/ + casdoor/conf（可选）
mkdir -p "$STAGING/app" "$STAGING/casdoor"
cp -a "$APP_DIR/data" "$STAGING/app/data"
rm -f "$STAGING/app/data"/*.db "$STAGING/app/data"/*.db-wal "$STAGING/app/data"/*.db-shm
[ -d "$CASDOOR_DIR/conf" ] && cp -a "$CASDOOR_DIR/conf" "$STAGING/casdoor/conf"

# 3) 一次 tar（staging 为根，路径剥 /tmp 前缀→ app/db/casdoor 相对布局）
tar -czf "$TMP" -C "$STAGING" app db casdoor
mv "$TMP" "$OUT"

# 保留最近 KEEP 份（按文件名排序，删最旧）
ls -1 "$DEST"/cyber-stray-*.tar.gz 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do
  rm -f "$old"
done

SIZE=$(du -h "$OUT" | cut -f1)
echo "备份完成: $OUT ($SIZE)"
echo "恢复: ./restore.sh $OUT"
