#!/usr/bin/env bash
# 安装/更新备份定时器（#268）——幂等，deploy.yml 每次发布都会执行
#
# 前置：unit 文件已由流水线 scp 到 /opt/cyber-stray/deploy/；
# 需要 root（systemd 单元目录写权限 + enable）。
set -euo pipefail

DEPLOY_DIR=${DEPLOY_DIR:-/opt/cyber-stray/deploy}

for unit in cyber-stray-backup.service cyber-stray-backup.timer; do
  [ -f "$DEPLOY_DIR/$unit" ] || { echo "缺少 $DEPLOY_DIR/$unit（先由 deploy.yml scp）"; exit 1; }
  install -m 644 "$DEPLOY_DIR/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now cyber-stray-backup.timer

echo "备份定时器已安装：systemctl list-timers cyber-stray-backup.timer"
