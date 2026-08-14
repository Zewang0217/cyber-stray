#!/usr/bin/env bash
# create-app.sh — 在 Casdoor 里创建 cyber-stray-web OIDC 应用（幂等）
#
# 机制：写 ~/casdoor/init_data.json（Casdoor 启动时自动导入，见 object/init_data.go）。
# 比管理 API 可靠：无需登录 token，schema 官方支持。
#
# 用法:
#   ./create-app.sh                 # 创建/更新应用，输出 client id/secret
#   ./create-app.sh --restart       # 写入后自动重启 Casdoor 使生效
#
# 幂等：已存在则复用 clientSecret，不重置。

set -euo pipefail

CASDOOR_HOME="${CASDOOR_HOME:-$HOME/casdoor}"
INIT_FILE="${CASDOOR_HOME}/init_data.json"
REDIRECT_URI="${CASDOOR_REDIRECT_URI:-http://localhost:3000/api/auth/callback}"
APP_NAME="cyber-stray-web"

if [ ! -f "$INIT_FILE" ]; then
  echo "[create-app] 未找到 $INIT_FILE，先生成 Casdoor 初始化数据（仅本应用）"
  echo '{"applications": []}' > "$INIT_FILE"
fi

node -e '
const fs = require("fs");
const path = process.argv[1];
const redirect = process.argv[2];
const appName = process.argv[3];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
if (!Array.isArray(data.applications)) data.applications = [];

let app = data.applications.find((a) => a.name === appName);
if (!app) {
  const { randomBytes } = require("crypto");
  app = {
    owner: "admin", name: appName, createdTime: new Date().toISOString(),
    displayName: "Cyber Stray Web", category: "Web", logo: "",
    homepageUrl: "http://localhost:3000", description: "赛博街溜子伴侣端",
    organization: "built-in", cert: "cert-built-in",
    enablePassword: true, enableSignUp: true, enableSigninSession: true,
    grantTypes: ["authorization_code"], responseTypes: ["code"],
    redirectUris: [redirect],
    clientId: appName, clientSecret: randomBytes(24).toString("hex"),
    tokenFormat: "JWT", expireInHours: 168, isOnboardApplication: false,
    signupItems: [],
  };
  data.applications.push(app);
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`[create-app] 已写入 ${appName} 到 ${path}`);
} else {
  console.log(`[create-app] ${appName} 已存在，复用 clientSecret`);
}
console.log("CASDOOR_CLIENT_ID=" + app.clientId);
console.log("CASDOOR_CLIENT_SECRET=" + app.clientSecret);
' "$INIT_FILE" "$REDIRECT_URI" "$APP_NAME"

if [ "${1:-}" = "--restart" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  "$SCRIPT_DIR/setup-casdoor.sh" stop >/dev/null 2>&1 || true
  "$SCRIPT_DIR/setup-casdoor.sh" start
  echo "[create-app] Casdoor 已重启，应用生效"
fi
