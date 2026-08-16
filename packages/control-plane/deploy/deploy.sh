#!/usr/bin/env bash
# ============================================================
# cyber-stray 一键部署（S12，#79）——2C4G 单机 systemd 拓扑
#
# 覆盖全栈：control-plane（API+调度器+推送网关）、web（Next.js
# standalone）、Casdoor（OIDC provider）。短命 worker 由调度器拉起，
# 无独立 unit（CP 进程组收口）。
#
# 三条纪律：
#   1. 崩溃自恢复 —— 全部 Restart=always + KillMode=control-group
#   2. 构建在 CI   —— 本脚本不编译；web 用 CI 产物，CP/agent bun 直跑 TS
#   3. 真实备份   —— backup.sh（tar）+ restore.sh（恢复演练见 README）
#
# 用法:
#   sudo ./deploy.sh install [--web-tar /path/to/web-standalone.tar.gz]
#   sudo ./deploy.sh status
#   sudo ./deploy.sh uninstall
#
# 前置（产机一次性）:
#   - bun（控制面运行时）: curl -fsSL https://bun.sh/install | bash
#   - node ≥ 22（web standalone 运行时）
#   - 仓库 clone 到 /opt/cyber-stray（git pull 更新，不编译）
# ============================================================
set -euo pipefail

APP_DIR=/opt/cyber-stray
WEB_DIR=/opt/cyber-stray-web
DEPLOY_DIR="$APP_DIR/packages/control-plane/deploy"
ENV_FILE="$APP_DIR/.env"

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "缺失依赖: $1"; exit 1; }; }

install() {
  require_cmd bun
  require_cmd node
  require_cmd openssl   # env 模板生成 secrets（rand -hex）

  # 可选参数：CI 产物路径（web standalone tar.gz）
  WEB_TAR=""
  if [ "${2:-}" = "--web-tar" ]; then
    WEB_TAR="${3:-}"
    [ -f "$WEB_TAR" ] || { echo "--web-tar 文件不存在: $WEB_TAR"; exit 1; }
  fi

  echo "==> [1/5] 仓库目录 $APP_DIR"
  [ -d "$APP_DIR/packages/control-plane" ] || { echo "未找到仓库（应 clone 到 $APP_DIR）"; exit 1; }

  echo "==> [2/5] 依赖安装（锁文件，不编译）"
  (cd "$APP_DIR" && pnpm install --frozen-lockfile)

  echo "==> [3/5] 环境变量"
  if [ ! -f "$ENV_FILE" ]; then
    # 模板：生成安全默认值，CASDOOR 三件套需按 create-app.sh 输出填
    {
      echo "# 控制面（必填）"
      echo "CP_SESSION_SECRET=$(openssl rand -hex 32)"
      echo "CP_MASTER_KEY=$(openssl rand -hex 32)"
      echo "CP_DATA_DIR=$APP_DIR/data"
      echo "CP_WEB_ORIGIN=http://localhost:3000"
      echo ""
      echo "# Casdoor OIDC（按 create-app.sh 输出填）"
      echo "CASDOOR_ISSUER=http://localhost:8000"
      echo "CASDOOR_CLIENT_ID="
      echo "CASDOOR_CLIENT_SECRET="
      echo "CASDOOR_REDIRECT_URI=http://localhost:3000/api/auth/callback"
      echo ""
      echo "# 生产覆盖（可选）"
      echo "# CP_PORT=8787"
      echo "# CP_SCHEDULER_MAX_CONCURRENT=4"
      echo "# CP_SCHEDULER_INTERVAL_MS=60000"
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "    生成 $ENV_FILE —— 编辑填写 CASDOOR_CLIENT_ID/SECRET 后重启"
  else
    echo "    已存在 $ENV_FILE（跳过）"
  fi

  echo "==> [4/5] web 产物（CI 构建，产机零编译）"
  if [ -n "$WEB_TAR" ]; then
    mkdir -p "$WEB_DIR"
    tar -xzf "$WEB_TAR" -C "$WEB_DIR"
    echo "    解包到 $WEB_DIR（server/server.js）"
  else
    echo "    未提供 --web-tar：web unit 已安装但暂不可启动（CI 产物到位后 systemctl start web）"
  fi

  echo "==> [5/5] systemd units"
  # bun 实际安装路径（bun.sh 装到 ~/.bun/bin/bun，未必在 /usr/local/bin）
  BUN_BIN="$(command -v bun)"
  if [ "$BUN_BIN" != "/usr/local/bin/bun" ]; then
    ln -sf "$BUN_BIN" /usr/local/bin/bun
    echo "    链接 bun: $BUN_BIN → /usr/local/bin/bun"
  fi
  # Casdoor（S2 已有 unit；安装到 /opt/casdoor 见 casdoor.service 头部注释）
  if [ -f /opt/casdoor/casdoor ] && [ ! -f /etc/systemd/system/casdoor.service ]; then
    cp "$DEPLOY_DIR/casdoor.service" /etc/systemd/system/
  fi
  cp "$DEPLOY_DIR/control-plane.service" /etc/systemd/system/
  cp "$DEPLOY_DIR/web.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now casdoor 2>/dev/null || true   # Casdoor 未装则跳过（可单独部署）
  systemctl enable --now control-plane
  systemctl enable --now web || {
    echo "警告: web 启动失败（产物未就位？）——CI 构建后重试: systemctl start web"
  }

  echo ""
  echo "部署完成。验证:"
  echo "  systemctl status control-plane web casdoor"
  echo "  curl http://localhost:8787/healthz"
  echo "  curl -I http://localhost:3000"
  echo "首次配置 Casdoor 应用: $DEPLOY_DIR/create-app.sh --restart"
  echo "备份: $DEPLOY_DIR/backup.sh  恢复: $DEPLOY_DIR/restore.sh"
}

status() {
  systemctl status control-plane --no-pager || true
  systemctl status web --no-pager || true
  systemctl status casdoor --no-pager || true
}

uninstall() {
  systemctl disable --now web control-plane casdoor 2>/dev/null || true
  rm -f /etc/systemd/system/web.service /etc/systemd/system/control-plane.service
  systemctl daemon-reload
  echo "units 已移除；数据保留于 $APP_DIR/data 与 $WEB_DIR（如需删除请手动）"
}

case "${1:-}" in
  install) install "$2" "$3" ;;
  status) status ;;
  uninstall) uninstall ;;
  *) echo "用法: $0 install [--web-tar <path>] | status | uninstall"; exit 2 ;;
esac
