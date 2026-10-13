#!/usr/bin/env bash
# Release entry point. Fetches one release bundle from OSS, verifies it, loads
# its images, brings the stacks up from the loaded images only, smoke-tests the
# loopback entry point of each stack, and records the released tag.
#
# The server pulls nothing from any registry or code host: everything arrives in
# the bundle, and compose runs with --pull never.
#
# Usage: deploy.sh <prod|staging> <40-char-hex-sha>
# Rollback: rerun this same command with the sha of the release to return to;
# bundles are kept in OSS per version. There is no automatic rollback - a failed
# deploy stops before the tag file is written, leaving the previous tag and the
# running stacks untouched.
set -euo pipefail

readonly ROOT=/srv/cyber-stray
readonly SHARED_ENV=$ROOT/.env
readonly CASDOOR_ROOT=/srv/casdoor
readonly APP_IMAGE=ghcr.io/zewang0217/cyber-stray-app
readonly WEB_IMAGE=ghcr.io/zewang0217/cyber-stray-web
readonly CADDY_IMAGE=ghcr.io/zewang0217/cyber-stray-caddy

die() { echo "deploy.sh: $*" >&2; exit "${EXIT_CODE:-1}"; }
step() { printf '\n==> %s\n' "$*"; }

usage() { echo "deploy.sh: usage: $0 <prod|staging> <40-char-hex-sha>" >&2; exit 2; }

ENVIRONMENT=${1:-}
TAG=${2:-}
[ $# -eq 2 ] || usage
case "$ENVIRONMENT" in
  prod|staging) ;;
  *) EXIT_CODE=2 die "environment must be prod or staging (got '$ENVIRONMENT')" ;;
esac
[[ $TAG =~ ^[0-9a-f]{40}$ ]] || { EXIT_CODE=2 die "tag must be a 40-char lowercase hex sha, e.g. c0ffee... (got '$TAG')"; }

step "release $TAG -> $ENVIRONMENT"

step "[1/7] load shared credentials ($SHARED_ENV)"
[ -f "$SHARED_ENV" ] || die "$SHARED_ENV missing: it must define OSS_BUCKET, OSS_ENDPOINT, OSS_REGION, OSS_SRV_ACCESS_KEY_ID, OSS_SRV_ACCESS_KEY_SECRET"
# Sourced without set -a so the OSS_* keys stay out of the environment that
# docker and other child processes inherit; only places that need them see them.
. "$SHARED_ENV"
for key in OSS_BUCKET OSS_ENDPOINT OSS_REGION OSS_SRV_ACCESS_KEY_ID OSS_SRV_ACCESS_KEY_SECRET; do
  [ -n "${!key:-}" ] || die "$SHARED_ENV does not define $key"
done

for tool in ossutil zstd docker sha256sum curl; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required command: $tool"
done
docker compose version >/dev/null 2>&1 || die "docker compose plugin unavailable"

# Credentials travel in the environment, never on a command line, so they cannot
# be read from the process list. Exported only now, so the checks above stay
# credential-free.
export OSS_ACCESS_KEY_ID=$OSS_SRV_ACCESS_KEY_ID
export OSS_ACCESS_KEY_SECRET=$OSS_SRV_ACCESS_KEY_SECRET
ossutil_opts=(-e "$OSS_ENDPOINT" --region "$OSS_REGION")
oss() { ossutil "${ossutil_opts[@]}" "$@"; }

APP_DIR=$ROOT/$ENVIRONMENT
COMPOSE_FILE=$APP_DIR/compose.yaml
ENV_FILE=$APP_DIR/.env
DATA_DIR=$APP_DIR/data
CURRENT_TAG_FILE=$APP_DIR/CURRENT_TAG
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE missing: provision the environment before deploying"
[ -f "$ENV_FILE" ] || die "$ENV_FILE missing: the environment's CP_PORT/WEB_PORT live there"

# Env files are KEY=VALUE with no shell semantics, so read the two values instead
# of sourcing them.
env_key() { awk -F= -v k="$1" '$1 == k { print $2; exit }' "$2"; }
CP_PORT=$(env_key CP_PORT "$ENV_FILE"); CP_PORT=${CP_PORT:-8787}
WEB_PORT=$(env_key WEB_PORT "$ENV_FILE"); WEB_PORT=${WEB_PORT:-3000}
[[ $CP_PORT =~ ^[0-9]+$ ]] || die "CP_PORT in $ENV_FILE is not a port number: '$CP_PORT'"
[[ $WEB_PORT =~ ^[0-9]+$ ]] || die "WEB_PORT in $ENV_FILE is not a port number: '$WEB_PORT'"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

step "[2/7] download the release bundle from OSS"
# One prefix holds the whole release: the packed images and the manifest that
# describes them. Both are fetched before anything on the server is touched.
release=oss://$OSS_BUCKET/releases/$TAG
oss cp "$release/images.tar.zst" "$TMP_DIR/images.tar.zst"
oss cp "$release/release.json" "$TMP_DIR/release.json"

step "[3/7] verify bundle integrity and completeness"
[ -s "$TMP_DIR/images.tar.zst" ] || die "images.tar.zst came back empty"
# The manifest is read by field name, so fields can be added to it without
# breaking an older deploy.sh that is already on the server. It is matched as one
# blob rather than line by line: the pipeline may or may not pretty-print it.
json_field() {
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$TMP_DIR/release.json" |
    head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}
manifest_tag=$(json_field tag)
manifest_sha=$(json_field sha256)
[ -n "$manifest_sha" ] || die "release.json has no sha256 field (expected format version 1)"
[ "$manifest_tag" = "$TAG" ] || die "release.json describes tag '$manifest_tag', expected '$TAG'"
actual_sha=$(sha256sum "$TMP_DIR/images.tar.zst" | awk '{print $1}')
[ "$actual_sha" = "$manifest_sha" ] || die "sha256 mismatch: manifest $manifest_sha, downloaded $actual_sha"
# -t reads the whole compressed stream and checks frame integrity, so a truncated
# download fails here instead of halfway through docker load.
zstd -q -t "$TMP_DIR/images.tar.zst" || die "images.tar.zst is corrupt (zstd integrity check failed)"
for image in "$APP_IMAGE:$TAG" "$WEB_IMAGE:$TAG" "$CADDY_IMAGE:$TAG"; do
  grep -q "\"$image\"" "$TMP_DIR/release.json" || die "release.json does not list required image $image"
done
echo "sha256 $actual_sha matches the manifest"

step "[4/7] load images (docker load, no registry access)"
zstd -q -d -o "$TMP_DIR/images.tar" "$TMP_DIR/images.tar.zst"
docker load -i "$TMP_DIR/images.tar"
rm -f "$TMP_DIR/images.tar"
for image in "$APP_IMAGE:$TAG" "$WEB_IMAGE:$TAG" "$CADDY_IMAGE:$TAG"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "image $image is not present after load"
done

# compose() runs one stack to a healthy state. --pull never is the point of the
# whole design: if an image is missing from the bundle, compose fails instead of
# quietly reaching out to a registry. IMAGE_TAG is exported so a plain `docker
# compose` by hand in that directory picks the same release.
compose() {
  local project=$1 dir=$2 file=$3
  ( cd "$dir" && IMAGE_TAG=$TAG docker compose -p "$project" -f "$file" up -d --pull never --wait )
}

step "[5/7] start stacks (infra -> casdoor -> $ENVIRONMENT)"
compose cyber-stray-infra "$ROOT/infra" compose.yaml
compose cyber-stray-casdoor "$CASDOOR_ROOT" compose.yaml
compose "cyber-stray-$ENVIRONMENT" "$APP_DIR" compose.yaml

step "[6/7] smoke test"
smoke() { curl -fsS --max-time 10 "$1" >/dev/null || die "smoke test failed: $1"; }
smoke "http://127.0.0.1:$WEB_PORT/login"
smoke "http://127.0.0.1:$CP_PORT/healthz"
# Ingress answers /healthz itself, so this proves Caddy is up and serving the
# site blocks - independent of which environment was just rolled out.
smoke "http://127.0.0.1/healthz"

step "[7/7] record the released tag"
printf '%s\n' "$TAG" >"$CURRENT_TAG_FILE"
echo "deployed $TAG to $ENVIRONMENT"
