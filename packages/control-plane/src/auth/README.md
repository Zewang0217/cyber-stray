# auth/ — 鉴权竖切

身份与租户解析：OIDC 登录（Casdoor PKCE）、session JWT 签发/验签、登录
CSRF state 存储、请求→租户解析唯一入口（request-tenant，绝不读 x-tenant-*
header）、requireTenant 路由中间件。

依赖方向：routes → auth → infra（tenant-access）/ shared；auth 不 import
services/domain。session cookie 名契约在 `@cyber-stray/shared/session`
（web 中间件登录墙同源）。
