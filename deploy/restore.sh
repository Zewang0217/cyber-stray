#!/usr/bin/env bash
# Restore one backup archive. Three jobs, one code path:
#   prod|staging  disaster recovery and data seeding - stops the stack, swaps the
#                 data tree, starts it again
#   local         seed a developer checkout: unpack into an explicit directory and
#                 leave every stack alone
#
# Source defaults to the newest backup of the environment in OSS; --from pins an
# exact object for a rehearsal or a deliberate rollback to an older snapshot.
#
# Usage:
#   restore.sh <prod|staging|local> [--from <oss-object>] [--with-accounts]
#              [--no-restart] [--dir <path>]
#
#   --from <oss-object>  oss://bucket/backups/<env>/backup-<stamp>.tar.zst
#   --with-accounts      also replace the Casdoor account database
#   --no-restart         swap files only, touch no container
#   --dir <path>         local only: destination directory (required for local)
set -euo pipefail

readonly ROOT=/srv/cyber-stray
readonly SHARED_ENV=$ROOT/.env
readonly CASDOOR_ROOT=/srv/casdoor
readonly CASDOOR_DB=$CASDOOR_ROOT/casdoor/casdoor.db

die() { echo "restore.sh: $*" >&2; exit "${EXIT_CODE:-1}"; }
usage() {
  echo "restore.sh: bad invocation" >&2
  awk '/^# Usage:/{ p = 1 } p && /^[^#]/ { exit } p { sub(/^# ?/, ""); print }' "$0" >&2
  exit 2
}

ENVIRONMENT=${1:-}
case "$ENVIRONMENT" in
  prod|staging|local) ;;
  '') usage ;;
  *) EXIT_CODE=2 die "environment must be prod, staging or local (got '$ENVIRONMENT')" ;;
esac
shift

SOURCE=''
WITH_ACCOUNTS=0
RESTART=1
DEST_DIR=''
while [ $# -gt 0 ]; do
  case "$1" in
    --from) [ $# -ge 2 ] || usage; SOURCE=$2; shift 2 ;;
    --with-accounts) WITH_ACCOUNTS=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    --dir) [ $# -ge 2 ] || usage; DEST_DIR=$2; shift 2 ;;
    *) EXIT_CODE=2 die "unknown argument: $1" ;;
  esac
done

if [ "$ENVIRONMENT" = local ]; then
  [ -n "$DEST_DIR" ] || { EXIT_CODE=2 die "--dir <path> is required for local restores"; }
elif [ -n "$DEST_DIR" ]; then
  EXIT_CODE=2 die "--dir is only meaningful for local restores"
fi

for tool in ossutil zstd tar sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required command: $tool"
done
[ "$RESTART" = 1 ] || [ "$ENVIRONMENT" = local ] || command -v docker >/dev/null 2>&1 || die "missing required command: docker"
. "$SHARED_ENV"
for key in OSS_BUCKET OSS_ENDPOINT OSS_REGION OSS_SRV_ACCESS_KEY_ID OSS_SRV_ACCESS_KEY_SECRET; do
  [ -n "${!key:-}" ] || die "$SHARED_ENV does not define $key"
done
export OSS_ACCESS_KEY_ID=$OSS_SRV_ACCESS_KEY_ID
export OSS_ACCESS_KEY_SECRET=$OSS_SRV_ACCESS_KEY_SECRET
oss() { ossutil -e "$OSS_ENDPOINT" --region "$OSS_REGION" "$@"; }

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
ARCHIVE=$TMP_DIR/backup.tar.zst

echo "==> [1/4] fetch the backup"
if [ -z "$SOURCE" ]; then
  # Local development seeds from production: it wants the product's real data and
  # a developer has no staging backup to point at.
  latest_env=$ENVIRONMENT
  [ "$latest_env" = local ] && latest_env=prod
  # The stamp is an ISO-8601 UTC string, so the newest key is simply the largest.
  SOURCE=$(oss ls -s "oss://$OSS_BUCKET/backups/$latest_env/" |
    grep -o "backup-[0-9]*T[0-9]*Z\.tar\.zst" | sort | tail -1)
  [ -n "$SOURCE" ] || die "no backups found under oss://$OSS_BUCKET/backups/$latest_env/"
  SOURCE=oss://$OSS_BUCKET/backups/$latest_env/$SOURCE
  echo "    newest backup: $SOURCE"
fi
oss cp "$SOURCE" "$ARCHIVE"
[ -s "$ARCHIVE" ] || die "fetched backup is empty: $SOURCE"

# The manifest is a sibling object; verify against it when it is there, but do not
# require it, so an archive can still be restored by hand from any location.
if oss cp "${SOURCE%.tar.zst}.json" "$TMP_DIR/manifest.json" 2>/dev/null; then
  expected=$(grep -o '"sha256"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMP_DIR/manifest.json" |
    head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  actual=$(sha256sum "$ARCHIVE" | awk '{print $1}')
  if [ -n "$expected" ]; then
    [ "$expected" = "$actual" ] || die "sha256 mismatch: manifest $expected, downloaded $actual"
    echo "    sha256 $actual matches the manifest"
  fi
fi
zstd -q -t "$ARCHIVE" || die "$SOURCE is corrupt (zstd integrity check failed)"
echo "==> [2/4] unpack"
mkdir -p "$TMP_DIR/tree"
zstd -q -dc "$ARCHIVE" | tar -x -C "$TMP_DIR/tree"
[ -d "$TMP_DIR/tree/data" ] || die "backup has no data/ tree"

if [ "$ENVIRONMENT" = local ]; then
  echo "==> [3/4] unpack into $DEST_DIR (no stack touched)"
  mkdir -p "$DEST_DIR"
  # Merge rather than replace: a developer's checkout usually already has working
  # files, and the archive only carries the data root.
  cp -a "$TMP_DIR/tree/data/." "$DEST_DIR/"
  [ -f "$TMP_DIR/tree/db/control.db" ] && cp -a "$TMP_DIR/tree/db/control.db" "$DEST_DIR/control.db"
  echo "==> [4/4] done: $(find "$DEST_DIR" -type f | wc -l) files under $DEST_DIR"
  exit 0
fi

[ -f "$TMP_DIR/tree/db/control.db" ] || die "backup has no db/control.db: refusing to restore an incomplete control-plane database"
APP_DIR=$ROOT/$ENVIRONMENT
DATA_DIR=$APP_DIR/data
[ -d "$APP_DIR" ] || die "$APP_DIR missing: provision the environment before restoring"
compose_of() { docker compose -p "$1" -f "$2" "${@:3}"; }

STOPPED=()
stop_stacks() {
  echo "==> [3/4] stop stacks"
  if [ "$RESTART" = 0 ]; then echo "    (--no-restart: containers left alone)"; return; fi
  compose_of "cyber-stray-$ENVIRONMENT" "$APP_DIR/compose.yaml" stop
  STOPPED+=("cyber-stray-$ENVIRONMENT" "$APP_DIR/compose.yaml")
  if [ "$WITH_ACCOUNTS" = 1 ]; then
    # The account database is per-instance, not per-environment, so it has to be
    # stopped before it is swapped.
    compose_of cyber-stray-casdoor "$CASDOOR_ROOT/compose.yaml" stop
    STOPPED+=("cyber-stray-casdoor" "$CASDOOR_ROOT/compose.yaml")
  fi
}
start_stacks() {
  echo "==> start stacks"
  [ "$RESTART" = 0 ] && { echo "    (--no-restart: containers left alone)"; return; }
  # start, not up: the containers and their images already exist, and this keeps
  # the restore independent of which release is currently recorded.
  for ((i = ${#STOPPED[@]} - 2; i >= 0; i -= 2)); do
    compose_of "${STOPPED[i]}" "${STOPPED[i + 1]}" start
  done
}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
stop_stacks

echo "==> [4/4] swap in the restored data"
# The old tree is moved aside first and the new tree moved in second: at no point
# is the only copy of the data deleted, so a failed move can be rolled back.
backup_of_existing=$APP_DIR/data.bak-$STAMP
if [ -d "$DATA_DIR" ]; then
  mv "$DATA_DIR" "$backup_of_existing"
  echo "    previous data kept at $backup_of_existing"
fi
cp -a "$TMP_DIR/tree/data" "$DATA_DIR"
# The live database is never in the tree (a copy of a running SQLite file is
# torn); the consistent snapshot from db/ is what lands in its place.
cp -a "$TMP_DIR/tree/db/control.db" "$DATA_DIR/control.db"

if [ "$WITH_ACCOUNTS" = 1 ]; then
  [ -f "$TMP_DIR/tree/db/casdoor.db" ] || die "backup has no db/casdoor.db but --with-accounts was given"
  [ -f "$CASDOOR_DB" ] && mv "$CASDOOR_DB" "$CASDOOR_DB.bak-$STAMP" && echo "    previous account database kept at $CASDOOR_DB.bak-$STAMP"
  cp -a "$TMP_DIR/tree/db/casdoor.db" "$CASDOOR_DB"
else
  # Seeding staging leaves the account database alone on purpose: both
  # environments share this single Casdoor instance, so restoring an older account
  # database would silently roll back real signups and edits for everyone.
  echo "    account database left untouched (pass --with-accounts to replace it)"
fi

start_stacks
echo "restored $ENVIRONMENT from $SOURCE"
echo "verify: curl http://127.0.0.1:\${CP_PORT:-8787}/healthz"
echo "roll back: restore.sh $ENVIRONMENT --from $SOURCE.old"
