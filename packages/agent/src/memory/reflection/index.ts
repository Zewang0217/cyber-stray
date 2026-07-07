/**
 * 反思模块导出
 *
 * Phase 4：反思回路——周期 LLM 反思把碎片观察合成为洞察记忆，更新兴趣图谱。
 */

export { ReflectionEngine, getReflectionEngine, _resetReflectionEngine } from './engine.js';
export type { ReflectionResult2 as ReflectionResult } from './engine.js';

export { ReflectionScheduler, getReflectionScheduler, _resetReflectionScheduler } from './scheduler.js';

export {
  ReflectionResultSchema,
  ReflectionInsightSchema,
  NewInterestSchema,
  InterestUpdateSchema,
  DEFAULT_REFLECTION_CONFIG,
  createDefaultSchedulerState,
} from './types.js';

export type {
  Provenance,
  NewInterest,
  InterestUpdate,
  ReflectionInsight,
  ReflectionConfig,
  SchedulerState,
} from './types.js';
