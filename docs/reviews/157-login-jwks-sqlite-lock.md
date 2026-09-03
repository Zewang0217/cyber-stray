# 生产事故记录:登录被 Casdoor 反复拉回（jwks × SQLite 写锁）

> **Issue**: PR #157
> **Date**: 2026-09-02
> **Severity**: 生产登录不可用(阻断)
> **Root cause**: casdoor 3.159.0 + SQLite 写锁竞态 → jwks 端点返回 200 + 错误体

## 现象

- 用户访问 `http://117.72.100.212` 登录,输完密码被**反复拉回登录页**,无法进入。
- CP 日志:
  ```
  JWKSInvalid: JSON Web Key Set malformed
    at createLocalJWKSet (jose)
    at handleCallback (oidc.ts:152:25)
  ```
- 此错误持续多次(12:50 四次、05:01 三次、重启后仍复现),每次 callback 后 302 回 `/api/auth/login?error=oidc_failed`。

## 排查过程（关键证据链）

1. **服务层全正常**:web/CP/casdoor 容器全部 healthy;discovery/jwks/token 端点外部 curl 全部 200。
2. **独立进程复现失败**:在 CP 容器内用 bun 独立脚本 fetch jwks → 永远 2542 字节完整 JWKS,`createLocalJWKSet` 通过。与应用进程行为矛盾。
3. **应用内 debug 日志抓铁证**(给 oidc.ts 打临时日志):
   ```
   [oidc-debug] jwks status = 200 ct = application/json; charset=utf-8 rawlen = 105
   [oidc-debug] jwks raw FULL = "{\n  \"status\": \"error\",\n  \"msg\": \"database is lock…
   [oidc-debug] parsed type = object keys = undefined
   ```
   → **jwks 端点返回 HTTP 200 + `{"status":"error","msg":"database is locked (5) (SQLITE_BUSY)"}`,无 `keys` 字段**。
4. **时序确认**(casdoor 日志):
   ```
   06:20:20.294  POST /api/login/oauth/access_token   200  (写库消费 code)
   06:20:20.297  GET  /.well-known/jwks              200  (3ms 后读库,撞锁)
   ```

## 根因

casdoor 3.159.0 使用 SQLite。登录回调中:

1. CP 用 code 换 token(`POST /api/login/oauth/access_token`)→ casdoor **写库**(消费 code)。
2. CP 紧接着 `GET /.well-known/jwks`(读库验签)→ 撞上写事务未释放的 **`SQLITE_BUSY`**。
3. Casdoor 对 DB 锁的响应**不是 5xx,而是 HTTP 200 + error JSON**(无 `keys`)。
4. jose `createLocalJWKSet` 收到无 `keys` 的对象 → `JWKSInvalid` → 回调失败 → 302 回登录页 = **无限拉回**。

**为什么外部复现不出**:独立 curl/脚本无 token 写并发,不撞锁;只有真实登录路径(token 交换后 3ms 读 jwks)才触发。

## 修复

`packages/control-plane/src/oidc.ts` 新增 `fetchJwksWithRetry`:

- 拉取 jwks 后**校验响应含非空 `keys` 数组**(而非仅 HTTP 200)。
- 校验失败 → 指数退避重试 3 次(150ms → 450ms → 1350ms)。
- 幂等只读,锁在 token 写提交后快速释放,重试窗口内即恢复。

## 验证

- `tsc --noEmit` 通过。
- control-plane 389 测试全绿。
- 生产注入修复版后,用户真实登录恢复,确认修复。

## 经验

1. **HTTP 200 不等于成功**——对 3rd-party OIDC 的响应必须校验结构(尤其 casdoor 在 DB 锁时返回 200+error body)。
2. **外部复现不到 ≠ 没问题**——瞬态竞态只在真实请求时序中出现;应尽早用应用内日志抓真实输入,而非反复外部模拟。
3. **casdoor(SQLite)写后立即读会撞锁**——OIDC 回调链里紧跟的读应容错重试。