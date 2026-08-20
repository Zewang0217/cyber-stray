# 0004 — 认证架构：组织 = 产品域，业务用户脱离 built-in

Casdoor 认证体系从"单应用绑 built-in"重构为**组织 = 产品域**模型。业务用户(宠物主人)注册到 `cyber-stray` 组织(普通用户),Casdoor 全局管理员域(built-in)不再承载业务用户。

## 背景与问题
部署时 Casdoor 只有一个应用 `cyber-stray-web` 绑 **built-in 组织**。built-in 是 Casdoor 自身的全局管理员域(**所有 built-in 用户都是全局管理员**,注册被 Casdoor 安全设计禁用)。业务注册需求出现时:注册页要求邮箱/手机号(验证服务未配,卡死)→ 修复注册项后暴露真正根因——**注册目标组织是 built-in,被拒**。

## 决策
- **Casdoor 组织 = 产品/项目域**。一个产品一个组织 + 一个应用(OIDC client);未来新项目 = 新组织 + 新应用,天然隔离。
- **built-in 组织**只留 Casdoor 自身管理,不承载业务用户,注册保持禁用。
- **租户隔离在 CP 层**(users/user_tenants 复合主键,首登自动建租户,租户键 = Casdoor sub),Casdoor 组织不参与业务路由——认证层只回答"你是谁",业务层回答"你能访问哪个租户"。
- **admin 两种角色分离**:Casdoor 全局管理员(built-in 身份,管 Casdoor 配置)vs cyber-stray 产品管理员(CP 层判定:`admins` 表 ∪ `CP_ADMIN_SUBS` env 白名单,管运营面板)。当前 admin 用户同时承担两者(合理);产品管理员判定**不迁移到 Casdoor role**(CP 的 admins 表 RBAC 已够,未来可增量解析 role claim,不推翻)。
- **注册简化**:仅用户名 + 显示名 + 密码(邮箱/手机号选填,字段保留),验证码后续按需加;防滥用靠 nginx 层限流(独立安全任务)。

## 执行变更(2026-08-20)
- 新建组织 `cyber-stray`(复制 built-in 结构,开放注册)
- admin 用户 `owner: built-in → cyber-stray`(id/密码不变 → OIDC sub 不变 → CP_ADMIN_SUBS/租户键不受影响)
- `cyber-stray-web` 应用改绑 `cyber-stray` 组织
- 注册项 Email/Phone → visible=false(两个应用都改)
- 验证:新用户注册成功(cyber-stray 组织,普通用户);admin Casdoor 登录正常;sub 不变

## Consequences
- 注册入口:`/signup/oauth/authorize?client_id=cyber-stray-web&...`(应用登录页的 sign up 链接)——`/signup` 裸路径仍走默认应用(app-built-in,built-in 组织),**禁注册保留**(不要直接访问注册)。
- 后续产品接入:建组织 + 应用 + CP OIDC 配置指向新应用。
- 已知安全债:Casdoor 8000 公网裸奔(未走 nginx,限流/HTTPS 未上)——独立任务。
