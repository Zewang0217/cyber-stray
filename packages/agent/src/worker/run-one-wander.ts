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
 * 成功游荡后等待到期的反思及状态持久化；短命进程退出前必须完成这些写入。
 */

import { loadConfig, setTenantContext, type TenantContext } from '../config.js';
import { loadState } from '../agent/state.js';
import { WanderAgent } from '../core/wander-agent.js';
import { getReflectionScheduler } from '../memory/reflection/index.js';
import { initializeTenantBrowserPolicy } from '../tools/browser/lifecycle.js';
import { assertUsageHealthy } from '../usage/usage.js';
import type { AgentSecrets, PlanExecutionArgs, WanderResult } from '../types.js';
import type { Catchphrase, PersonalityId } from '@cyber-stray/shared';
import type { PetStats } from '@cyber-stray/shared/pet-stats';

/** runOneWander 入参 */
export interface RunOneWanderOptions {
  /** 租户键（如 org slug / 注册 id），仅用于标识与日志 */
  tenantId: string;
  /** 该租户隔离的数据目录（DATA_DIR = 租户键） */
  dataDir: string;
  /** per-tenant 敏感信息（控制面解密后注入；未提供的字段回退进程环境变量） */
  secrets?: AgentSecrets;
  /** 套餐执行参数（S11 门控；未注入 = 单用户模式，不设限） */
  planArgs?: PlanExecutionArgs;
  /** 性格（#90：探索倾向 + 语气注入；未注入 = 好奇，行为不回退） */
  personality?: PersonalityId;
  /** 口头禅（#114：当前有效集合；未注入 = 性格默认组） */
  catchphrases?: Catchphrase[];
  /**
   * 宠物数值（ADR-0013 注入：真相源在 CP pets 表，调度器从库带出）。
   * 必传——state.json 的数值是已退役的陈旧副本，缺注入即失败，禁兜底回退。
   */
  petStats: PetStats;
}

/** 反思失败时携带已完成的游荡回报，不能把完成的数值和内容丢给整轮重试。 */
export class WanderReflectionError extends Error {
  constructor(readonly result: WanderResult, cause: unknown) {
    super(`游荡已完成，反思失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'WanderReflectionError';
  }
}

/**
 * 为指定租户执行一次游荡并退出。
 *
 * 成功返回 WanderResult；失败抛错（不兜底）。调用方（调度器）据此决定
 * 重试/告警。租户上下文在 finally 中清除，进程可继续跑下一租户。
 */
export async function runOneWander(options: RunOneWanderOptions): Promise<WanderResult> {
  const config = loadConfig(options.dataDir, options.secrets, options.planArgs, options.personality, options.catchphrases);
  const ctx: TenantContext = {
    tenantId: options.tenantId,
    dataDir: options.dataDir,
    config,
  };

  setTenantContext(ctx);
  try {
    await initializeTenantBrowserPolicy();
    const timeoutMs = options.planArgs?.llmTimeoutMs;
    const deadlineMs = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    const abortSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
    const fileState = await loadState();
    const reflection = getReflectionScheduler();
    await reflection.load();
    await reflection.retryPending(abortSignal);
    abortSignal?.throwIfAborted();
    if (deadlineMs !== undefined && config.plan) {
      // 恢复反思也占同一短命 worker 预算，不能给后续游荡重新发完整时间额度。
      config.plan = { ...config.plan, llmTimeoutMs: Math.max(0, deadlineMs - Date.now()) };
    }
    // 数值以注入为准（ADR-0013）；state.json 只出叙事字段（游荡计数/最近话题等）
    const state = {
      ...fileState,
      boredom: options.petStats.boredom,
      energy: options.petStats.energy,
      mood: options.petStats.mood,
      temper: options.petStats.temper,
    };
    const agent = new WanderAgent(config);
    const result = await agent.wander(state);
    if (result.endReason !== 'error') {
      try {
        assertUsageHealthy(options.dataDir);
        await reflection.tick(abortSignal);
        assertUsageHealthy(options.dataDir);
      } catch (error) {
        throw new WanderReflectionError(result, error);
      }
    }
    assertUsageHealthy(options.dataDir);
    return result;
  } finally {
    setTenantContext(null);
  }
}
