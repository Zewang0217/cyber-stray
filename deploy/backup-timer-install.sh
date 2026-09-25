#!/usr/bin/env bash
# 安装/更新备份定时器（幂等），deploy.yml 每次发布执行。需要 root。
set -euo pipefail

DEPLOY_DIR=${DEPLOY_DIR:-/opt/cyber-stray/deploy}

for unit in cyber-stray-backup.service cyber-stray-backup.timer; do
  [ -f "$DEPLOY_DIR/$unit" ] || { echo "缺少 $DEPLOY_DIR/$unit（先由 deploy.yml scp）"; exit 1; }
  install -m 644 "$DEPLOY_DIR/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now cyber-stray-backup.timer

echo "备份定时器已安装：systemctl list-timers cyber-stray-backup.timer"
