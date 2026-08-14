# S2 · Casdoor 自托管部署

Casdoor（Apache 2.0，Go 单二进制 + SQLite）作为控制面的 OIDC provider。本目录交付：

| 文件 | 用途 |
|---|---|
| `setup-casdoor.sh` | 本地开发：下载二进制到 `~/casdoor`、写 SQLite 配置、启动/停止/状态 |
| `casdoor.service` | 生产（VPS）：systemd unit，`/opt/casdoor` |
| `create-app.sh` | 首次运行后：在 Casdoor 里创建 cyber-stray OIDC 应用（见下） |

## 本地开发

```bash
./setup-casdoor.sh install   # 下载 + 配置（~40MB，一次）
./setup-casdoor.sh start     # nohup 后台跑 :8000
./setup-casdoor.sh status    # 检查 + 打印 OIDC discovery
```

首次启动后默认管理员 `admin / 123`（登录 UI 后请修改）。

## 创建 OIDC 应用（一次）

Casdoor 需要为控制面建一个 application（OIDC 客户端）。机制：`create-app.sh` 写
`~/casdoor/init_data.json`（Casdoor 官方启动导入机制，无需登录 token），
**写入后需重启 Casdoor 生效**（`--restart` 自动完成）。

```bash
./create-app.sh --restart        # 建/更新应用（幂等，复用 clientSecret）+ 重启 Casdoor
```

输出 `CASDOOR_CLIENT_ID` / `CASDOOR_CLIENT_SECRET` 供控制面配置。
UI 方式备选：应用页添加 `cyber-stray-web`（组织 `built-in`，回调
`http://localhost:3000/api/auth/callback`，grant `authorization_code`）。

## 配置控制面

```bash
# packages/control-plane/.env（或环境变量）
CASDOOR_ISSUER=http://localhost:8000
CASDOOR_CLIENT_ID=<上一步的 client id>
CASDOOR_CLIENT_SECRET=<上一步的 client secret>
CASDOOR_REDIRECT_URI=http://localhost:3000/api/auth/callback
CP_SESSION_SECRET=<openssl rand -hex 32>   # ≥32 字节
CP_WEB_ORIGIN=http://localhost:3000
```

## 生产部署（VPS）

```bash
# 按 casdoor.service 头部注释安装到 /opt/casdoor
sudo systemctl enable --now casdoor
# Nginx 反代：casdoor.example.com → :8000；回调域名与 CASDOOR_REDIRECT_URI 对齐
```

## 已知限制（当前验证环境）

- **注册需邮箱验证码**：Casdoor 默认 signupItems 含邮箱验证，未配置 SMTP 时注册页会要求验证码而无法完成。**验证环境用现有账号登录**（admin/123 或预建用户）；生产配 SMTP 或调整应用 signupItems 去掉验证项。
- **SQLite 并发**：Casdoor 账号库 SQLite 需 `busy_timeout`（setup 脚本已带 `?_pragma=busy_timeout(10000)`），否则并发请求会偶发 `database is locked`（jwks/token 端点）。
- **租户键 = Casdoor sub（UUID）**：首登自动建租户目录 `data/tenants/<sub>/`，sub 是 Casdoor 签发的 uuid（非用户名），天然无斜杠/特殊字符。

## 数据与备份

- 账号库 = `~/casdoor/casdoor.db`（SQLite 单文件）——备份 = `tar` 该文件 + `conf/`。
- 与租户数据隔离：Casdoor 只管"谁"（身份），租户数据在控制面 `data/tenants/<sub>/`。
