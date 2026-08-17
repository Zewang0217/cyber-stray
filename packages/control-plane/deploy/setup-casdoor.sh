#!/usr/bin/env bash
# setup-casdoor.sh — 本地开发/单机部署 Casdoor（进程方式跑，不依赖 systemd）
#
# 用法:
#   ./setup-casdoor.sh install   # 下载二进制到 ~/casdoor 并初始化配置
#   ./setup-casdoor.sh start     # 启动（后台，nohup）
#   ./setup-casdoor.sh stop      # 停止
#   ./setup-casdoor.sh status    # 检查存活
#
# 生产（VPS）: 用同目录 casdoor.service（systemd unit），二进制放 /opt/casdoor。
# 数据: ~/casdoor/casdoor.db（SQLite 账号库）+ ~/casdoor/conf/app.conf

set -euo pipefail

CASDOOR_HOME="${CASDOOR_HOME:-$HOME/casdoor}"
CASDOOR_VERSION="v3.153.0"
CASDOOR_URL="https://github.com/casdoor/casdoor/releases/download/${CASDOOR_VERSION}/casdoor_Linux_x86_64.tar.gz"
CASDOOR_PORT="${CASDOOR_PORT:-8000}"

install() {
  mkdir -p "$CASDOOR_HOME"
  cd "$CASDOOR_HOME"

  if [ ! -f casdoor ]; then
    echo "[casdoor] 下载 $CASDOOR_URL"
    curl -sL -o casdoor.tar.gz "$CASDOOR_URL"
    tar -xzf casdoor.tar.gz --strip-components=1
    rm -f casdoor.tar.gz
    chmod +x casdoor
  fi

  # conf/app.conf：SQLite 账号库（唯一真相源，覆盖 tar 自带的 MySQL 默认配置）
  mkdir -p conf
  cat > conf/app.conf <<EOF
appname = casdoor
httpport = $CASDOOR_PORT
runmode = dev
copyfromorigin = true
driverName = sqlite
dataSourceName = casdoor.db?_pragma=busy_timeout(10000)
dbName = casdoor.db
dbHost =
dbPort = 3306
dbUser =
dbPassword =
dbName2 =
dbHost2 =
dbPort2 = 3306
dbUser2 =
dbPassword2 =
dbName3 =
dbHost3 =
dbPort3 = 3306
dbUser3 =
dbPassword3 =
initScore = 0
logPostOnly = true
origin = http://localhost:$CASDOOR_PORT
EOF
  echo "[casdoor] conf/app.conf 已写入（端口 $CASDOOR_PORT，SQLite）"

  echo "[casdoor] 安装完成于 $CASDOOR_HOME"
  echo "[casdoor] 默认管理员: admin / 123（首次登录后请修改）"
}

start() {
  cd "$CASDOOR_HOME"
  if pgrep -x casdoor >/dev/null 2>&1; then
    echo "[casdoor] 已在运行"
    return 0
  fi
  nohup ./casdoor > casdoor.log 2>&1 &
  echo "[casdoor] 已启动 (pid $!) → http://localhost:$CASDOOR_PORT"
}

stop() {
  pkill -x casdoor 2>/dev/null && echo "[casdoor] 已停止" || echo "[casdoor] 未在运行"
}

status() {
  if pgrep -x casdoor >/dev/null 2>&1; then
    echo "[casdoor] running"
    curl -s -m 5 "http://localhost:$CASDOOR_PORT/.well-known/openid-configuration" | head -c 200
    echo
  else
    echo "[casdoor] stopped"
    exit 1
  fi
}

case "${1:-}" in
  install) install ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "用法: $0 {install|start|stop|status}"
    exit 2
    ;;
esac
