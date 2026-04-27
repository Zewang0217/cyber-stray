/**
 * 长期记忆模块导出
 *
 * @example
 * import { getMemoryStore, recordInteraction, buildMemoryPromptContext } from './memory/long-term';
 */

// 核心
export { MemoryStore, getMemoryStore } from './long-term/index.js';
export type {
  MemoryEntry,
  MemoryType,
  MemoryIndex,
  MemoryContextOptions,
  MemoryConfig,
} from './long-term/types.js';

// 写入
export {
  recordInteraction,
  recordFeedback,
  recordKnowledge,
  recordObservation,
  updateUserPreference,
  recordWanderSummary,
} from './long-term/write.js';

// 读取
export {
  getUserProfile,
  getUserPreferences,
  getRecentInteractions,
  getTopicKnowledge,
  getObservations,
  searchMemory,
  buildMemoryPromptContext,
  getMemoryStats,
  getTodaySummary,
} from './long-term/read.js';

// 容量管理
export { MemoryConsolidator, getMemoryConsolidator } from './long-term/consolidate.js';
