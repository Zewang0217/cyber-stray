#!/usr/bin/env bash
# cyber-stray 备份（S12，#79）——真实可恢复，非摆设
#
# 覆盖三块可恢复数据：
#   1. 控制面 data/（tenants/ 租户目录、control.db、master.key）——核心
#   2. Casdoor 账号库（/opt/cyber-stray/casdoor/{casdoor.db, conf/}）——身份
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
CASDOOR_DIR=${CASDOOR_DIR:-/opt/cyber-stray/casdoor}
STAGING=$(mktemp -d)

# 失败告警（#267）：飞书群机器人 webhook，OPS_ALERT_WEBHOOK_URL 未设则静默跳过
# （本地/演练无 webhook 不报错）；curl 失败也不改变退出码（告警是尽力而为）。
alert() {
  [ -n "${OPS_ALERT_WEBHOOK_URL:-}" ] || return 0
  curl -fsS -m 10 -X POST -H 'content-type: application/json' \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$1\"}}" \
    "$OPS_ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}
# EXIT trap（而非 ERR）：set -e 下 if/while 条件内的 exit 1 不触发 ERR trap，
# 但 EXIT 必到——按退出码判失败（PR #303 review P1-2）
trap 'rc=$?; rm -rf "$STAGING"; [ $rc -ne 0 ] && alert "[cyber-stray] 备份失败：backup.sh 退出码 $rc，主机 $(hostname)"; exit $rc' EXIT

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

# ─── 异地副本（#268）：备份与生产同机，主机级故障 = 数据与唯一备份同灭 ───
# S3 兼容对象存储经 docker 跑 pinned amazon/aws-cli（产机必有 docker，不新增
# 宿主机依赖）。凭据走 env（可经 cyber-stray-backup.service 的
# EnvironmentFile 注入）：BACKUP_OFFSITE_ENDPOINT / BUCKET / ACCESS_KEY /
# SECRET_KEY。未配置 = 显式跳过（凭据属 HITL checklist，缺省不弄脏每日备份）；
# 配置了但推送失败 = 非零退出 + webhook 告警（BACKUP_ALERT_WEBHOOK_URL，与
# #267 告警票同一通道）。本地保留 KEEP 份不变，异地保留 BACKUP_OFFSITE_KEEP
# 份（默认 30）。
OFFSITE_ENDPOINT=${BACKUP_OFFSITE_ENDPOINT:-}
OFFSITE_BUCKET=${BACKUP_OFFSITE_BUCKET:-}
OFFSITE_ACCESS_KEY=${BACKUP_OFFSITE_ACCESS_KEY:-}
OFFSITE_SECRET_KEY=${BACKUP_OFFSITE_SECRET_KEY:-}
if [ -z "$OFFSITE_ENDPOINT" ] || [ -z "$OFFSITE_BUCKET" ] ||    [ -z "$OFFSITE_ACCESS_KEY" ] || [ -z "$OFFSITE_SECRET_KEY" ]; then
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

# 推送 + 异地保留策略一次进容器收口（省 N 次容器启动）：
# cp 本次产物 → ls 列全量 → 按文件名排序删最旧，只留 OFFSITE_KEEP 份
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
