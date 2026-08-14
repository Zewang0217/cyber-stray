/**
 * runOneWander — 租户化短命 worker 入口（SaaS 地基，issue #68）
 *
 * 一次游荡 = 一个可复制的执行单元：
 *   加载租户配置（行为参数 + per-tenant secrets）→ 设置租户上下文
 *   → loadState → WanderAgent.wander（含后处理：记记忆/写历史/存状态）
 *   → 清除租户上下文 → 返回结果
 *
 * 由调度器（S5）拉起的外部入口：同一进程可先后跑多个租户的游荡，
 * 数据目录/配置/单例缓存按租户键隔离，互不串数据。
 *
 * 注意：本入口不含浏览器预热/反思调度/心跳——那是常驻 Harness 或调度器
 * 的职责；浏览器按租户隔离（browser/lifecycle 按数据根键化），需要时由
 * 调用方显式 warmUp。
 */

import { loadConfig, setTenantContext, type TenantContext } from '../config.js';
import { loadState } from '../agent/state.js';
import { WanderAgent } from '../core/wander-agent.js';
import type { AgentSecrets, WanderResult } from '../types.js';

/** runOneWander 入参 */
export interface RunOneWanderOptions {
  /** 租户键（如 org slug / 注册 id），仅用于标识与日志 */
  tenantId: string;
  /** 该租户隔离的数据目录（DATA_DIR = 租户键） */
  dataDir: string;
  /** per-tenant 敏感信息（控制面解密后注入；未提供的字段回退进程环境变量） */
  secrets?: AgentSecrets;
}

/**
 * 为指定租户执行一次游荡并退出。
 *
 * 成功返回 WanderResult；失败抛错（不兜底）。调用方（调度器）据此决定
 * 重试/告警。租户上下文在 finally 中清除，进程可继续跑下一租户。
 */
export async function runOneWander(options: RunOneWanderOptions): Promise<WanderResult> {
  const config = loadConfig(options.dataDir, options.secrets);
  const ctx: TenantContext = {
    tenantId: options.tenantId,
    dataDir: options.dataDir,
    config,
  };

  setTenantContext(ctx);
  try {
    const state = await loadState();
    const agent = new WanderAgent(config);
    return await agent.wander(state);
  } finally {
    setTenantContext(null);
  }
}
