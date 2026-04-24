/**
 * @deprecated ReAct 架构中不再使用固定行动类型
 *
 * 原因：`VALID_ACTIONS` 是旧 Pipeline 架构的遗留，
 * ReAct 架构中只有 Tools（search_web / read_page / speak / rest），
 * 不再有固定的行动类型枚举。
 *
 * 替代方案：src/agent/react.ts 中的 Tool Calling 循环
 *
 * 保留此文件供参考，后续可能删除。
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
