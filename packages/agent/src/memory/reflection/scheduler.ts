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

import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { consola } from '../../logger.js';
import { getDataPath } from '../../config.js';
import { getReflectionEngine } from './engine.js';
import {
  DEFAULT_REFLECTION_CONFIG,
  createDefaultSchedulerState,
} from './types.js';
import type { ReflectionConfig, SchedulerState } from './types.js';
import type { ReflectionResult2 } from './engine.js';

const logger = consola.withTag('ReflectionScheduler');

const STATE_PATH = 'reflection-state.json';

// ============================================
// 原子写
// ============================================

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/')) || '.';
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(data, null, 2);
  await writeFile(tmp, payload, 'utf-8');
  await rename(tmp, path);
}

// ============================================
// ReflectionScheduler
// ============================================

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

    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<SchedulerState>;
      this.state = {
        ...createDefaultSchedulerState(),
        ...parsed,
        wanderCount: typeof parsed.wanderCount === 'number' ? parsed.wanderCount : 0,
        totalReflections: typeof parsed.totalReflections === 'number' ? parsed.totalReflections : 0,
      };
    } catch (error) {
      logger.warn('加载调度器状态失败，使用默认状态', { error });
      this.state = createDefaultSchedulerState();
    }
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
   * 判断是否需要触发反思，若需要则异步执行（不阻塞主流程）。
   *
   * @returns 本次是否触发了反思
   */
  async tick(): Promise<boolean> {
    if (!this.cfg.enabled) {
      return false;
    }

    // 游荡计数累加
    this.state.wanderCount += 1;
    await this.persist();

    // 检查触发条件
    const shouldReflect = this.checkTrigger();
    if (!shouldReflect) {
      return false;
    }

    // 防重叠：上次反思还在进行中则跳过
    if (this.reflecting) {
      logger.debug('上次反思仍在进行中，跳过本次触发');
      return false;
    }

    // 异步执行反思，不阻塞调用方
    this.reflecting = true;
    this.executeReflection().finally(() => {
      this.reflecting = false;
    });

    return true;
  }

  /** 同步获取调度器状态（供外部查询） */
  getState(): Readonly<SchedulerState> {
    return this.state;
  }

  // ==========================================
  // Private
  // ==========================================

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
  private async executeReflection(): Promise<void> {
    const startTime = Date.now();
    let result: ReflectionResult2;

    try {
      const engine = getReflectionEngine(this.cfg);
      result = await engine.reflect();
    } catch (error) {
      logger.error('反思执行失败', { error });
      return;
    }

    const durationMs = Date.now() - startTime;

    // 更新状态
    this.state.lastReflectionAt = new Date().toISOString();
    this.state.totalReflections += 1;
    await this.persist();

    logger.info('反思调度完成', {
      durationMs,
      ...result,
    });
  }
}

// ============================================
// 单例
// ============================================

let defaultScheduler: ReflectionScheduler | null = null;

export function getReflectionScheduler(
  cfg?: Partial<ReflectionConfig>,
): ReflectionScheduler {
  if (!defaultScheduler) {
    defaultScheduler = new ReflectionScheduler(cfg);
  }
  return defaultScheduler;
}

/** 重置单例（测试隔离） */
export function _resetReflectionScheduler(): void {
  defaultScheduler = null;
}
