import { consola } from '../logger';
import { search } from '../tools/search/index.js';
import { filterResults } from '../tools/filter/index.js';
import { config } from '../config.js';
import type { Decision, AgentState } from '../types';

const logger = consola.withTag('actions');

/**
 * 执行狩猎行动
 * Phase 5: 搜索话题 → 筛选结果 → TODO: 生成文案 → 推送
 */
export async function executeHunt(decision: Decision, state: AgentState): Promise<void> {
  const topic = decision.params?.topic ?? state.userLikes[state.userLikes.length - 1] ?? '科技新闻';

  logger.info('执行狩猎', { topic, reasoning: decision.reasoning });

  const results = await search(topic, { maxResults: config.maxSearchResults });

  if (results.length === 0) {
    logger.warn('搜索无结果', { topic });
    return;
  }

  const filtered = await filterResults(results, state, { topic });

  if (filtered.length === 0) {
    logger.warn('筛选后无合格结果', { topic, originalCount: results.length });
    return;
  }

  logger.success('筛选完成', {
    topic,
    originalCount: results.length,
    filteredCount: filtered.length,
    topScore: filtered[0]?.score,
    topResult: filtered[0]?.title,
  });
}

/**
 * 执行发呆行动
 * 什么都不干，恢复精力
 */
export async function executeRest(): Promise<void> {
  logger.info('执行发呆', { message: '街溜子决定趴会儿...' });
  // 实际逻辑：状态已在外部更新，这里只是占位
}

/**
 * 执行抱怨行动
 * TODO: Phase 4 实现
 * 发一条带情绪的吐槽到飞书
 */
export async function executeComplain(decision: Decision): Promise<void> {
  logger.info('执行抱怨', { reasoning: decision.reasoning });

  // TODO: 生成抱怨文案
  // const content = await generateComplaint(decision.reasoning);

  // TODO: 推送到飞书
  // await pushToFeishu(content);

  logger.success('抱怨完成（骨架阶段，未实际推送）');
}

/**
 * 执行得瑟行动
 * TODO: Phase 4 实现
 * 发一条炫耀消息到飞书
 */
export async function executeCelebrate(decision: Decision): Promise<void> {
  logger.info('执行得瑟', { reasoning: decision.reasoning });

  // TODO: 生成得瑟文案
  // const content = await generateCelebration(decision.reasoning);

  // TODO: 推送到飞书
  // await pushToFeishu(content);

  logger.success('得瑟完成（骨架阶段，未实际推送）');
}

/**
 * 执行罢工行动
 * TODO: Phase 4 实现
 * 故意不理主人，可能发一条高冷消息
 */
export async function executeIgnore(decision: Decision): Promise<void> {
  logger.info('执行罢工', { reasoning: decision.reasoning });

  // TODO: 可能发一条高冷消息，或者干脆沉默

  logger.success('罢工完成（骨架阶段）');
}

/**
 * 执行拖延行动
 * TODO: Phase 4 实现
 * 该干不干，磨蹭一会儿
 */
export async function executeProcrastinate(decision: Decision): Promise<void> {
  logger.info('执行拖延', { reasoning: decision.reasoning });

  // TODO: 可能发一条"等会儿再说"的消息

  logger.success('拖延完成（骨架阶段）');
}

/**
 * 行动分发器
 * 根据决策结果路由到对应的执行函数
 */
export async function executeAction(
  decision: Decision,
  state: AgentState,
): Promise<void> {
  logger.info('执行行动', { action: decision.action });

  switch (decision.action) {
    case 'hunt':
      await executeHunt(decision, state);
      break;
    case 'rest':
      await executeRest();
      break;
    case 'complain':
      await executeComplain(decision);
      break;
    case 'celebrate':
      await executeCelebrate(decision);
      break;
    case 'ignore':
      await executeIgnore(decision);
      break;
    case 'procrastinate':
      await executeProcrastinate(decision);
      break;
    default:
      // 未知行动，保守处理为 rest
      logger.warn('未知行动类型，回退到 rest', { action: decision.action });
      await executeRest();
  }
}
