/**
 * 反思调度器（ReflectionScheduler）
 *
 * Phase 4 (REF-01)：管理反思触发时机——每 N 次游荡或每 M 小时。
 *
 * 调度策略：
 * - wanderCount 达到 wanderInterval 的整数倍 → 触发
 * - 或距离上次反思超过 hourInterval 小时 → 触发
 * - 取先到者
 *
 * 状态持久化到 data/reflection-state.json。
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { getDataPath } from '../../config.js';
import { atomicWriteJson } from '../../utils/atomic-json.js';
import { getReflectionEngine } from './engine.js';
import {
  DEFAULT_REFLECTION_CONFIG,
  createDefaultSchedulerState,
} from './types.js';
import type { ReflectionConfig, SchedulerState } from './types.js';
import type { ReflectionResult2 } from './engine.js';

const logger = consola.withTag('ReflectionScheduler');

const STATE_PATH = 'reflection-state.json';
const SchedulerStateSchema = z.object({
  pendingReflection: z.boolean().default(false),
  wanderCount: z.number().int().nonnegative(),
  totalReflections: z.number().int().nonnegative(),
  lastReflectionAt: z.string().datetime({ offset: true }).nullable(),
});

// ReflectionScheduler

export class ReflectionScheduler {
  private cfg: ReflectionConfig;
  private state: SchedulerState;
  private statePath: string;
  /** 并发写串行排队 */
  private persistChain: Promise<void> = Promise.resolve();
  /** 是否正在反思中（防重叠） */
  private reflecting = false;

  constructor(
    cfg?: Partial<ReflectionConfig>,
    state?: SchedulerState,
    statePath?: string,
  ) {
    this.cfg = { ...DEFAULT_REFLECTION_CONFIG, ...cfg };
    this.state = state ?? createDefaultSchedulerState();
    this.statePath = statePath ?? getDataPath(STATE_PATH);
  }

  /** 加载调度器状态 */
  async load(): Promise<void> {
    if (!existsSync(this.statePath)) {
      this.state = createDefaultSchedulerState();
      return;
    }

    const raw = await readFile(this.statePath, 'utf-8');
    this.state = SchedulerStateSchema.parse(JSON.parse(raw));
  }

  /** 持久化调度器状态 */
  async persist(): Promise<void> {
    this.persistChain = this.persistChain.then(async () => {
      await atomicWriteJson(this.statePath, this.state);
    });
    await this.persistChain;
  }

  /**
   * 每次游荡结束后调用。
   * 判断是否需要反思，等待执行及持久化完成。短命 worker 必须 await；
   * 常驻 Harness 可自行选择异步调用并处理错误。
   *
   * @returns 本次是否触发了反思
   */
  async tick(abortSignal?: AbortSignal): Promise<boolean> {
    if (!this.cfg.enabled) {
      return false;
    }

    // 游荡计数与待反思标记一起持久化，短命进程退出后仍能恢复阶段。
    this.state.wanderCount += 1;
    const shouldReflect = this.checkTrigger();
    if (shouldReflect) this.state.pendingReflection = true;
    await this.persist();
    return this.retryPending(abortSignal);
  }

  /** 新 worker 恢复未完成反思；不递增游荡计数，不重做已交付的探索。 */
  async retryPending(abortSignal?: AbortSignal): Promise<boolean> {
    if (!this.cfg.enabled || !this.state.pendingReflection || this.reflecting) return false;
    this.reflecting = true;
    try {
      await this.executeReflection(abortSignal);
    } finally {
      this.reflecting = false;
    }

    return true;
  }

  /** 同步获取调度器状态（供外部查询） */
  getState(): Readonly<SchedulerState> {
    return this.state;
  }

  // Private

  /** 检查是否应该触发反思 */
  private checkTrigger(): boolean {
    const { wanderInterval, hourInterval } = this.cfg;

    // 按游荡次数触发
    if (this.state.wanderCount > 0 && this.state.wanderCount % wanderInterval === 0) {
      logger.debug('反思触发：达到游荡次数', {
        wanderCount: this.state.wanderCount,
        interval: wanderInterval,
      });
      return true;
    }

    // 按时间间隔触发
    if (this.state.lastReflectionAt && hourInterval > 0) {
      const elapsed =
        (Date.now() - new Date(this.state.lastReflectionAt).getTime()) / (1000 * 60 * 60);
      if (elapsed >= hourInterval) {
        logger.debug('反思触发：达到时间间隔', {
          elapsedHours: elapsed.toFixed(1),
          interval: hourInterval,
        });
        return true;
      }
    }

    // 首次游荡后还未反思过，且游荡次数达标
    if (!this.state.lastReflectionAt && this.state.wanderCount >= wanderInterval) {
      logger.debug('反思触发：首次触发', { wanderCount: this.state.wanderCount });
      return true;
    }

    return false;
  }

  /** 执行反思并更新状态 */
  private async executeReflection(abortSignal?: AbortSignal): Promise<void> {
    const startTime = Date.now();
    let result: ReflectionResult2;

    try {
      const engine = getReflectionEngine(this.cfg);
      result = await engine.reflect(abortSignal);
    } catch (error) {
      logger.error('反思执行失败', { error });
      throw error;
    }

    const durationMs = Date.now() - startTime;

    // 更新状态
    if (result.executed) {
      this.state.lastReflectionAt = new Date().toISOString();
      this.state.totalReflections += 1;
    }
    this.state.pendingReflection = false;
    await this.persist();

    logger.info('反思调度完成', {
      durationMs,
      ...result,
    });
  }
}
// 单例

/** 按 statePath 键化——租户模式同一进程多租户各自持实例与状态文件 */
const schedulerCache = new Map<string, ReflectionScheduler>();

export function getReflectionScheduler(
  cfg?: Partial<ReflectionConfig>,
): ReflectionScheduler {
  const statePath = getDataPath(STATE_PATH);
  if (!schedulerCache.has(statePath)) {
    schedulerCache.set(statePath, new ReflectionScheduler(cfg));
  }
  return schedulerCache.get(statePath)!;
}

/** 重置单例（测试隔离） */
export function _resetReflectionScheduler(): void {
  schedulerCache.clear();
}
