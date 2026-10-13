#!/usr/bin/env bash
# Nightly backup: consistent SQLite snapshots of the control-plane database and
# the Casdoor account database, plus the environment's data tree (tenant files
# and master key), packed into one archive and pushed to OSS.
#
# The same archive is what restore.sh consumes for all three of its jobs
# (disaster recovery, staging data seeding, and local development seeding), so a
# backup is never a candidate until it has been restored once.
#
# SQLite is snapshotted with `sqlite3 .backup`, not copied: a plain copy of a
# live database is a torn snapshot that interleaves with WAL writes.
#
# Usage: backup.sh [prod|staging]   (default: prod)
set -euo pipefail

readonly ROOT=/srv/cyber-stray
readonly SHARED_ENV=$ROOT/.env
readonly CASDOOR_ROOT=/srv/casdoor
readonly CASDOOR_DB=$CASDOOR_ROOT/casdoor/casdoor.db

die() { echo "backup.sh: $*" >&2; exit "${EXIT_CODE:-1}"; }
usage() { echo "backup.sh: usage: $0 [prod|staging]" >&2; exit 2; }

ENVIRONMENT=${1:-prod}
[ $# -le 1 ] || usage
case "$ENVIRONMENT" in
  prod|staging) ;;
  *) EXIT_CODE=2 die "environment must be prod or staging (got '$ENVIRONMENT')" ;;
esac

for tool in ossutil zstd sqlite3 tar sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required command: $tool"
done

[ -f "$SHARED_ENV" ] || die "$SHARED_ENV missing: it must define OSS_BUCKET, OSS_ENDPOINT, OSS_REGION, OSS_SRV_ACCESS_KEY_ID, OSS_SRV_ACCESS_KEY_SECRET"
# Not sourced with set -a: the OSS keys stay out of what child processes inherit
# and are exported only for ossutil, so they never reach a command line either.
. "$SHARED_ENV"
for key in OSS_BUCKET OSS_ENDPOINT OSS_REGION OSS_SRV_ACCESS_KEY_ID OSS_SRV_ACCESS_KEY_SECRET; do
  [ -n "${!key:-}" ] || die "$SHARED_ENV does not define $key"
done
export OSS_ACCESS_KEY_ID=$OSS_SRV_ACCESS_KEY_ID
export OSS_ACCESS_KEY_SECRET=$OSS_SRV_ACCESS_KEY_SECRET
oss() { ossutil -e "$OSS_ENDPOINT" --region "$OSS_REGION" "$@"; }

APP_DATA=$ROOT/$ENVIRONMENT/data
[ -d "$APP_DATA" ] || die "control-plane data directory missing: $APP_DATA"
[ -f "$APP_DATA/control.db" ] || die "control-plane database missing: $APP_DATA/control.db"
[ -f "$CASDOOR_DB" ] || die "Casdoor database missing: $CASDOOR_DB"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

echo "==> snapshot databases"
mkdir -p "$STAGING/tree/db"
sqlite3 "$APP_DATA/control.db" ".backup '$STAGING/tree/db/control.db'"
sqlite3 "$CASDOOR_DB" ".backup '$STAGING/tree/db/casdoor.db'"

echo "==> assemble the environment's data tree"
cp -a "$APP_DATA" "$STAGING/tree/data"
# The running database is replaced by the snapshot above; -wal/-shm belong to a
# database instance that will not exist after a restore.
rm -f "$STAGING/tree/data"/control.db "$STAGING/tree/data"/control.db-wal "$STAGING/tree/data"/control.db-shm
# Rotated logs are not data; keeping them would grow every archive forever and
# they are worthless after a recovery.
rm -rf "$STAGING/tree/data/logs"

echo "==> pack"
ARCHIVE=$STAGING/backup-$STAMP.tar.zst
tree_listing=$(cd "$STAGING/tree" && find data db -type f | sort)
tar -C "$STAGING/tree" -cf - data db | zstd -q -T0 -o "$ARCHIVE"
digest=$(sha256sum "$ARCHIVE" | awk '{print $1}')
files=$(printf '%s\n' "$tree_listing" | awk '{ printf "%s\"%s\"", sep, $0; sep = "," }')
cat >"$STAGING/backup-$STAMP.json" <<EOF
{
  "version": 1,
  "env": "$ENVIRONMENT",
  "timestamp": "$STAMP",
  "sha256": "$digest",
  "files": [$files]
}
EOF
echo "    $(wc -c <"$ARCHIVE") bytes, sha256 $digest"

echo "==> upload to OSS"
oss cp "$ARCHIVE" "oss://$OSS_BUCKET/backups/$ENVIRONMENT/backup-$STAMP.tar.zst"
oss cp "$STAGING/backup-$STAMP.json" "oss://$OSS_BUCKET/backups/$ENVIRONMENT/backup-$STAMP.json"
echo "backup $ENVIRONMENT $STAMP uploaded to oss://$OSS_BUCKET/backups/$ENVIRONMENT/"
# No local retention: the OSS bucket's lifecycle rule is the retention policy, and
# keeping a second copy on the machine being backed up buys nothing.
