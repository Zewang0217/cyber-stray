# Review · #71 · S4 per-tenant secrets 信封加密

> 两轴审查 · `review` skill
> 基线 `01216c0` (S3) → `cc10074` (S4) · 单提交 · 6 文件 +620 / −1
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `01216c0` (S3) |
| Target | `cc10074` (S4) |
| Commit | `feat(control-plane): S4 per-tenant secrets 信封加密（#71)` |
| Scope | 6 文件 +620 / −1 |
| Spec | [issue #71](https://github.com/Zewang0217/cyber-stray/issues/71) |

## Standards

**0 硬违规 / 2 判断题。** 核心红线全守住。

**禁兜底**（guides/index.md + conventions.md）——全部通过，无掩盖：
- `master-key.ts:35/54`：仅吞 `ENOENT`（文件不存在=合法仅 env 态），非 ENOENT 一律 `throw`；非法内容显式抛「master.key 内容非法」。合法空值，非兜底。
- `tenant-secrets.ts:77` `decryptWith` 失败：`throw new Error('secrets 解密失败…', {cause})`，**绝不返回默认值**；空/短密文显式抛格式错误。
- `tenant-secrets.ts:100` `run.catch(()=>undefined)`：锁链仅保留错误不中断，真实错误经 `run` 传播给调用者（注释明示）。错误未吞。判断题。
- `tenant-secrets.ts:136/157` `loadEnvelope`/`saveEnvelope`：`readDek` ENOENT→null 合法 + 半遗忘态显式抛 `MissingDekError`，绝不静默重建。

**无明文落盘**（CONTEXT.md 安全硬规矩）——合规。DEK 以 MK 包裹密文存 `dek.enc`；envelope（含键名）整体 DEK 加密存 DB `tenant_secrets.encrypted`；测试扫描 dataDir 断言明文值+键名零出现；无 secret 进日志/错误信息。

**信封加密结构**（CONTEXT.md）——合规。MK→包每租户 DEK→存租户目录；AES-256-GCM（与 PR #54 一致）；AAD=tenantId 防跨租户搬移；不用 Vault。

**方法/缩进/JSDoc**——合规。最长 `decryptWith` ~15 行；`openTenantSecrets` ~9 行导出函数（非 270 行单函数）；导出函数均有中文 JSDoc。

**最小变更**——合规。`config.ts` 仅文档注释（+4）；`index.ts` 仅 import + fail-fast 预热（+4）。

判断题：
1. `tenant-secrets.ts` `run.catch(()=>undefined)` 锁链吞 reject——注释已明示错误经 `run` 传播，但字面 catch 值得留意。
2. `0o600`×3、`'wx'`、`\u0000`、`{1,64}` 等字面量未抽常量（`0o600` 为惯例权限，轻微）；`index.ts:69` `console.log` banner 为前序提交遗留（非新增）。

**最严重**：无——所有 catch 均正确 rethrow，半遗忘态显式报错而非静默重建，符合禁兜底红线。

## Spec

**0 硬缺失 / 0 实现有误 / 0 超范围。** 三条验收准则全部满足。

验收对照：
- ✅ 租户 secrets 加解密可用，DEK 独立——`tenant-secrets.test.ts` roundtrip；A/B 租户 DEK 隔离；AAD=tenantId 防搬移测试；`forget()` 删行+删 DEK=忘租户（删 DEK 后该租户 secrets 不可解密）。
- ✅ 存取接口供 worker / 推送网关使用——`openTenantSecrets` 导出，`worker-runner.ts:127` `writeSecretsFile` 解密→写 0600 临时 JSON→finally 删除；`channels.ts:61/90/101` GET/POST/DELETE 用 `openTenantSecrets` 存取 `feishu_webhook`。
- ✅ 无明文 secrets 落盘——envelope 整体加密含键名，DEK 被 MK 包裹存 `dek.enc`；测试扫描 dataDir 断言明文值+键名零出现。

**最严重**：无——spec 三准则全部达成，且消费方（worker-runner / channels）已真实接入。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 0 | 2 | run.catch 锁链 + 0o600 等魔法值（均轻微） |
| Spec | 0 | 0 | 无 |

S4 是目前质量最高的切片：加密实现严格遵循禁兜底与信封加密硬规矩，消费方接入完整，测试覆盖充分（master-key 7 测试 + tenant-secrets 12 测试，含无明文扫描、防搬移、半遗忘、并发）。
