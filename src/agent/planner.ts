import {
  buildDecisionSystemPrompt,
  buildDecisionUserPrompt,
} from '../prompts/decision.js';
import { callLLMForDecision } from '../llm/client.js';
import { consola } from '../logger.js';
import type { AgentState, Decision } from '../types.js';

const logger = consola.withTag('planner');

/**
 * 决策阈值配置
 * 用于短路判断，避免不必要的 LLM 调用
 */
const DECISION_THRESHOLDS = {
  /** 无聊值低于此阈值时，直接返回 rest（不用 LLM 决策） */
  MIN_BOREDOM_TO_HUNT: 30,
  /** 精力值低于此阈值时，强制返回 rest */
  MIN_ENERGY_TO_ACT: 20,
  /** 无聊值高于此阈值时，强制触发 hunt */
  FORCE_HUNT_BOREDOM: 90,
} as const;

/**
 * 短路判断：是否需要调用 LLM 做决策
 *
 * 规则：
 * 1. 精力 < MIN_ENERGY_TO_ACT → 强制 rest
 * 2. 无聊 < MIN_BOREDOM_TO_HUNT → 直接 rest（不调用 LLM）
 * 3. 无聊 > FORCE_HUNT_BOREDOM → 强制 hunt（不调用 LLM）
 * 4. 其他情况 → 需要 LLM 决策
 */
function shouldShortCircuitDecision(state: AgentState): Decision | null {
  // 精力耗尽，强制休息
  if (state.energy < DECISION_THRESHOLDS.MIN_ENERGY_TO_ACT) {
    logger.debug('精力耗尽，强制休息', { energy: state.energy });
    return {
      action: 'rest',
      reasoning: '累瘫了，先趴会儿...',
    };
  }

  // 无聊值太低，不值得出去 hunting
  if (state.boredom < DECISION_THRESHOLDS.MIN_BOREDOM_TO_HUNT) {
    logger.debug('无聊值太低，继续发呆', { boredom: state.boredom });
    return {
      action: 'rest',
      reasoning: '还不怎么无聊，再躺会儿~',
    };
  }

  // 无聊值爆表，强制狩猎
  if (state.boredom >= DECISION_THRESHOLDS.FORCE_HUNT_BOREDOM) {
    logger.debug('无聊值爆表，强制狩猎', { boredom: state.boredom });
    return {
      action: 'hunt',
      reasoning: '无聊死了！！！必须出去找点乐子！！',
    };
  }

  // 需要 LLM 决策
  return null;
}

/**
 * 构建 LLM 决策所需的 prompts
 */
function buildDecisionPrompts(state: AgentState): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: buildDecisionSystemPrompt(),
    userPrompt: buildDecisionUserPrompt(state),
  };
}

/**
 * 决策主函数
 *
 * 流程：
 * 1. 短路判断（省钱）
 * 2. 构建 prompt
 * 3. 调用 LLM（结构化输出）
 * 4. 返回决策结果
 */
export async function decide(state: AgentState): Promise<Decision> {
  // 1. 短路判断
  const shortCircuit = shouldShortCircuitDecision(state);
  if (shortCircuit) {
    logger.info('短路决策', { action: shortCircuit.action, reasoning: shortCircuit.reasoning });
    return shortCircuit;
  }

  // 2. 构建 prompt
  const { systemPrompt, userPrompt } = buildDecisionPrompts(state);

  // 3. 调用 LLM
  logger.info('调用 LLM 决策', { boredom: state.boredom, energy: state.energy, mood: state.mood });

  try {
    const decision = await callLLMForDecision(systemPrompt, userPrompt);
    logger.info('LLM 决策完成', { action: decision.action, reasoning: decision.reasoning });
    return decision;
  } catch (error) {
    logger.error('LLM 决策失败，回退到 rest', { error: String(error) });
    // 出错时保守处理，返回 rest
    return {
      action: 'rest',
      reasoning: '脑子短路了，趴会儿...',
    };
  }
}
