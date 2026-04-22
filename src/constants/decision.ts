/**
 * Agent 可用行动类型定义
 *
 * 所有行动类型集中维护于此，修改此处即可扩展或调整 Agent 行为。
 * Planner、LLM Client 及状态机均从此处读取合法行动列表。
 */

export const VALID_ACTIONS = [
  'hunt',
  'rest',
  'complain',
  'celebrate',
  'ignore',
  'procrastinate',
] as const;

export type ActionType = (typeof VALID_ACTIONS)[number];
