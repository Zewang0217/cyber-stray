#!/usr/bin/env bash
# cyber-stray 备份：控制面 data/（租户目录 + master.key）、control.db、
# casdoor.db + conf/ 打成单个 tar.gz 到 /backup/cyber-stray/，
# 本地保留最近 BACKUP_KEEP 份（默认 7）。web 无本地状态，不备份。
#
# SQLite 用 sqlite3 .backup 做事务一致拷贝——直接 tar 运行中的库会得到
# 与 WAL 交错的撕裂快照；未装 sqlite3 时显式警告并降级为热拷贝。
# 落盘：临时目录组装 → 一次 tar → mv 就位，中途失败不产生半截产物。
#
# 异地副本：BACKUP_OFFSITE_{ENDPOINT,BUCKET,ACCESS_KEY,SECRET_KEY} 齐备时，
# 本地落盘后经 docker 跑 amazon/aws-cli 推送到 S3 兼容对象存储（不新增宿主机
# 依赖），异地保留 BACKUP_OFFSITE_KEEP 份（默认 30）。未配置 = 显式跳过；
# 配置了但推送失败 = 非零退出，并经 BACKUP_ALERT_WEBHOOK_URL（飞书 webhook）告警。
# 凭据建议放 /opt/cyber-stray/backup.env（root:600），运行前 source 注入，见 README。
#
# 用法: ./backup.sh
set -euo pipefail

DEST=${BACKUP_DIR:-/backup/cyber-stray}
KEEP=${BACKUP_KEEP:-7}
APP_DIR=${APP_DIR:-/opt/cyber-stray}
CASDOOR_DIR=${CASDOOR_DIR:-/opt/cyber-stray/casdoor}
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

[ -d "$APP_DIR/data" ] || { echo "控制面数据目录不存在: $APP_DIR/data"; exit 1; }

mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
TMP="$DEST/.cyber-stray-$STAMP.tar.gz.part"
OUT="$DEST/cyber-stray-$STAMP.tar.gz"

# 1) SQLite 事务一致快照 → staging/db/
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

# 2) 组装 staging 树：app/data（排除运行中 SQLite 文件，已由上面的快照取代）
#    + db/ + casdoor/conf（可选）
mkdir -p "$STAGING/app" "$STAGING/casdoor"
cp -a "$APP_DIR/data" "$STAGING/app/data"
rm -f "$STAGING/app/data"/*.db "$STAGING/app/data"/*.db-wal "$STAGING/app/data"/*.db-shm
[ -d "$CASDOOR_DIR/conf" ] && cp -a "$CASDOOR_DIR/conf" "$STAGING/casdoor/conf"

# 3) 打包（staging 为根 → tar 内是 app/db/casdoor 相对布局）
tar -czf "$TMP" -C "$STAGING" app db casdoor
mv "$TMP" "$OUT"

# 保留最近 KEEP 份（按文件名时间戳排序，删最旧）
ls -1 "$DEST"/cyber-stray-*.tar.gz 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do
  rm -f "$old"
done

SIZE=$(du -h "$OUT" | cut -f1)
echo "备份完成: $OUT ($SIZE)"
echo "恢复: ./restore.sh $OUT"

# 异地副本
OFFSITE_ENDPOINT=${BACKUP_OFFSITE_ENDPOINT:-}
OFFSITE_BUCKET=${BACKUP_OFFSITE_BUCKET:-}
OFFSITE_ACCESS_KEY=${BACKUP_OFFSITE_ACCESS_KEY:-}
OFFSITE_SECRET_KEY=${BACKUP_OFFSITE_SECRET_KEY:-}
if [ -z "$OFFSITE_ENDPOINT" ] || [ -z "$OFFSITE_BUCKET" ] || [ -z "$OFFSITE_ACCESS_KEY" ] || [ -z "$OFFSITE_SECRET_KEY" ]; then
  echo "异地副本未配置（BACKUP_OFFSITE_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY），仅保留本地"
  exit 0
fi

OFFSITE_KEEP=${BACKUP_OFFSITE_KEEP:-30}
OFFSITE_REGION=${BACKUP_OFFSITE_REGION:-us-east-1}
OFFSITE_IMAGE=${BACKUP_OFFSITE_IMAGE:-amazon/aws-cli:2.27.48}
OFFSITE_PREFIX=cyber-stray

offsite_fail() {
  echo "错误: 异地副本失败: $1" >&2
  if [ -n "${BACKUP_ALERT_WEBHOOK_URL:-}" ]; then
    if command -v curl >/dev/null 2>&1; then
      curl -sf -X POST -H 'content-type: application/json' \
        -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"[cyber-stray] 备份异地副本失败（$(hostname)）: $1\"}}" \
        "$BACKUP_ALERT_WEBHOOK_URL" >/dev/null \
        || echo "警告: 告警 webhook 发送失败（BACKUP_ALERT_WEBHOOK_URL）" >&2
    else
      echo "警告: 未装 curl，告警无法发送（BACKUP_ALERT_WEBHOOK_URL 已配置）" >&2
    fi
  fi
  exit 1
}

# 推送 + 清理过期副本在一次容器内完成（省多次容器启动）：
# cp 本次产物 → ls 全量 → 按文件名排序删最旧，只留 OFFSITE_KEEP 份
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$OFFSITE_ACCESS_KEY" \
  -e AWS_SECRET_ACCESS_KEY="$OFFSITE_SECRET_KEY" \
  -e AWS_DEFAULT_REGION="$OFFSITE_REGION" \
  -e OFFSITE_ENDPOINT="$OFFSITE_ENDPOINT" \
  -e OFFSITE_TARGET="s3://$OFFSITE_BUCKET/$OFFSITE_PREFIX" \
  -e OFFSITE_KEY="$(basename "$OUT")" \
  -e OFFSITE_KEEP="$OFFSITE_KEEP" \
  -v "$DEST:/backup:ro" \
  --entrypoint sh "$OFFSITE_IMAGE" -c '
    set -eu
    aws --endpoint-url "$OFFSITE_ENDPOINT" s3 cp \
      "/backup/$OFFSITE_KEY" "$OFFSITE_TARGET/$OFFSITE_KEY"
    keys=$(aws --endpoint-url "$OFFSITE_ENDPOINT" s3 ls "$OFFSITE_TARGET/" | awk "{print \$4}" | sort)
    count=$(printf "%s\n" "$keys" | grep -c . || true)
    if [ "$count" -gt "$OFFSITE_KEEP" ]; then
      printf "%s\n" "$keys" | head -n -"$OFFSITE_KEEP" | while read -r k; do
        [ -n "$k" ] || continue
        aws --endpoint-url "$OFFSITE_ENDPOINT" s3 rm "$OFFSITE_TARGET/$k"
        echo "异地过期副本已删: $k"
      done
    fi
  ' || offsite_fail "s3 推送/清理出错（endpoint=$OFFSITE_ENDPOINT bucket=$OFFSITE_BUCKET）"

echo "异地副本完成: s3://$OFFSITE_BUCKET/$OFFSITE_PREFIX/$(basename "$OUT")（保留 $OFFSITE_KEEP 份）"
