/**
 * 反馈管道（Feedback Pipeline）
 *
 * 编排飞书表情反馈 → 用户画像更新 + 兴趣图谱加权的完整链路。
 *
 * Phase 3 (USR-02)：闭合"反馈驱动"半边——用户点赞不再只改心情，
 * 而是实际加权兴趣方向和用户画像。
 *
 * 架构：
 * 1. speak 时 registerSpeakTopics() 记下 messageId → 当前 Top 兴趣
 * 2. 反馈到达时 processFeedback() 查映射 → updateUserProfile + InterestGraph.reinforce
 *
 * 消息-主题映射为内存存储（重启丢失，但反馈通常在推送后数分钟到达）。
 */

import { consola } from '../logger.js';
import { recordFeedback } from './feedback-store.js';
import { updateUserProfileBatch, type ProfileUpdateEntry } from './user-profile.js';
import { getInterestGraph } from './interest-graph.js';
import { regenerateProfileSummary } from './profile-summary.js';
import { updateMoodByFeedback } from '../agent/state.js';
import {
  CATCHPHRASE_WEIGHT_FLOOR,
  getPersonality,
  type Catchphrase,
} from '@cyber-stray/shared';
import { getConfig } from '../config.js';

const logger = consola.withTag('FeedbackPipeline');

/** 反馈创建新兴趣节点的种子权重（like 新话题 / boost 新话题共用，S2 #151） */
const FEEDBACK_SEED_WEIGHT = 0.3;

/** 消息-兴趣主题映射（messageId → 推送时的 Top 兴趣 ID 列表） */
const messageTopicMap = new Map<string, string[]>();

/** 映射最大容量（防内存泄漏，LRU 语义——满时删最旧的） */
const MAP_MAX_SIZE = 200;

/**
 * 注册推送消息关联的兴趣主题。
 * speak 成功后调用，以便后续反馈能找到对应兴趣。
 *
 * @param messageId - 飞书/Telegram 消息 ID
 * @param topics - 推送时 Agent 的 Top 兴趣 ID 列表
 */
export function registerSpeakTopics(messageId: string, topics: string[]): void {
  if (!messageId || topics.length === 0) return;

  // 容量控制：满时删最旧的条目
  if (messageTopicMap.size >= MAP_MAX_SIZE) {
    const firstKey = messageTopicMap.keys().next().value;
    if (firstKey !== undefined) {
      messageTopicMap.delete(firstKey);
    }
  }

  messageTopicMap.set(messageId, topics);
  logger.debug('注册消息-兴趣映射', { messageId, topics });
}

/** 反馈处理结果 */
export interface FeedbackProcessResult {
  /** 反馈是否已记录 */
  recorded: boolean;
  /** 是否找到了关联的兴趣主题 */
  topicsMatched: boolean;
  /** 匹配到的兴趣主题 */
  matchedTopics: string[];
  /** 本次 speak 用到的口头禅文本（#114 归因；未匹配为空数组） */
  matchedCatchphrases: string[];
  /** 归因调整后的口头禅集合（#114：CP 写回 pets.catchphrases；无归因为 null） */
  catchphrasesUpdated: Catchphrase[] | null;
  /** 画像是否已更新 */
  profileUpdated: boolean;
  /** 兴趣是否已强化 */
  interestReinforced: boolean;
}

/** 口头禅权重归因增量（± 同兴趣图谱 LIKE/DISLIKE 增量） */
const CATCHPHRASE_DELTA = 0.1;

/**
 * 口头禅权重归因（#114 纯函数）：like ↑ / dislike ↓，下限 CATCHPHRASE_WEIGHT_FLOOR
 * （防被踩到消失，ADR 0005）。matched 外的条目原样保留。
 */
export function applyCatchphraseFeedback(
  current: Catchphrase[],
  type: 'like' | 'dislike',
  matched: string[],
): Catchphrase[] {
  if (matched.length === 0) return current;
  const matchedSet = new Set(matched);
  return current.map((c) => {
    if (!matchedSet.has(c.text)) return c;
    const next =
      type === 'like' ? c.weight + CATCHPHRASE_DELTA : c.weight - CATCHPHRASE_DELTA;
    return { ...c, weight: Math.max(CATCHPHRASE_WEIGHT_FLOOR, Number(next.toFixed(4))) };
  });
}

/**
 * 叶子优先归因（S2 #151）。
 *
 * 反馈目标是 speak 时的 matchedTopics（可能是父级节点）。规则：
 * - 目标存在且为叶子 → 直接返回自身
 * - 目标存在且为父级（有子节点）→ 返回其叶子后代（归因到叶子，不碰父级）
 * - 目标存在为纯父（无子节点）→ 视作叶子返回自身（当前扁平图谱下所有节点即叶子）
 * - 目标不存在 → 返回 undefined（调用方决定：like 新话题入图 / dislike 忽略）
 */
function resolveLeafTarget(graph: ReturnType<typeof getInterestGraph>, topic: string): string | undefined {
  const node = graph.getNode(topic);
  if (!node) return undefined;

  const leafDesc = graph.getLeafDescendants(topic);
  // 纯父（getLeafDescendants 返回自身）→ 当叶子处理
  return leafDesc[0] ?? topic;
}

/** 画像批量更新（容错路径）：失败仅记日志——反馈已记录、配额已兑现，画像缺失可重算 */
async function updateProfileForFeedback(
  type: 'like' | 'dislike',
  topics: string[],
): Promise<boolean> {
  const entries: ProfileUpdateEntry[] = topics.map((topic) => ({ type, topic }));
  try {
    await updateUserProfileBatch(entries);
    return true;
  } catch (error) {
    logger.error('批量更新用户画像失败', { error, type, topics });
    return false;
  }
}

/**
 * 兴趣图谱信号落盘（S2 #151）：叶子优先归因 → persist → 增量重生成摘要。
 *
 * persist / 摘要失败必须上抛：兴趣强化是反馈的核心承诺
 * （S9 review 硬违规 #2：吞错 → 配额 consumed 但兴趣未强化）。
 *
 * @returns 是否有节点被强化/衰减
 */
async function updateGraphForFeedback(
  type: 'like' | 'dislike',
  topics: string[],
): Promise<boolean> {
  const graph = getInterestGraph();
  // 确保 graph 已初始化
  if (!graph.isInitialized() && graph.getNodeCount() === 0) {
    await graph.load();
  }

  let reinforced = false;
  for (const topic of topics) {
    // 叶子优先归因：父级 → 叶子；纯父 → 自身
    const target = resolveLeafTarget(graph, topic);
    if (!target) {
      if (type === 'like') {
        // 点赞新话题：入图后应用信号（feedback 来源）
        graph.addInterest(topic, FEEDBACK_SEED_WEIGHT, 'feedback');
        graph.applySignal(topic, type);
        reinforced = true;
      } else {
        // dislike 目标不存在：无节点可降，跳过（不碰父级/兄弟，符合 S2）
        logger.debug('dislike 目标不存在，跳过', { topic });
      }
      continue;
    }
    graph.applySignal(target, type);
    // dislike 只落叶子：父级仅经重聚合间接受影响，兄弟节点完全不受影响
    if (type === 'dislike' && target !== topic) {
      logger.info('dislike 归因到叶子，父级未直击', { topic, leaf: target });
    }
    reinforced = true;
  }

  // 所有 topic 处理完后一次持久化（N 个 topic → 1 次原子写）
  await graph.persist();
  // S2 #151：反馈后增量重生成 profile-summary（失败上抛——摘要过期=数据不一致）
  await regenerateProfileSummary(graph);
  return reinforced;
}

/**
 * Step 2 话题归因解析：优先显式传入（S9 REST：worker 退出后内存 map 失效，
 * 调用方从 speaks 历史 matchedTopics 反查），否则查内存映射。
 * 命中与否写回 result（topicsMatched / matchedTopics）。
 * @returns 归因到的话题；未命中返回 undefined
 */
function resolveFeedbackTopics(
  type: 'like' | 'dislike',
  messageId: string | undefined,
  opts: { topics?: string[] },
  result: FeedbackProcessResult,
): string[] | undefined {
  const explicitTopics = opts.topics?.filter((t) => t.length > 0);
  const topics = explicitTopics?.length ? explicitTopics : messageTopicMap.get(messageId ?? '');
  if (topics && topics.length > 0) {
    result.topicsMatched = true;
    result.matchedTopics = topics;
    logger.info('反馈匹配到兴趣主题', { type, messageId, topics });
    return topics;
  }
  logger.debug('反馈未匹配到兴趣主题（可能是旧消息或映射已清理）', { messageId });
  return undefined;
}

/**
 * Step 2b（#114）口头禅归因：调用方从 speaks 历史反查传入命中文本；
 * 权重调整结果经 result 返回，由控制面写回 pets.catchphrases（DB 唯一写者）
 */
function attributeCatchphrases(
  type: 'like' | 'dislike',
  messageId: string | undefined,
  opts: { catchphrases?: string[] },
  result: FeedbackProcessResult,
): void {
  const matchedPhrases = (opts.catchphrases ?? []).filter((t) => t.length > 0);
  if (matchedPhrases.length === 0) return;
  const cfg = getConfig();
  const current = cfg.catchphrases ?? getPersonality(cfg.personality).catchphrases;
  result.matchedCatchphrases = matchedPhrases;
  result.catchphrasesUpdated = applyCatchphraseFeedback(current, type, matchedPhrases);
  logger.info('反馈归因口头禅', { type, messageId, matchedPhrases });
}

/** FeedbackProcessResult 初始值（各入口共用，防字段增减漏改） */
function emptyResult(partial: Partial<FeedbackProcessResult> = {}): FeedbackProcessResult {
  return {
    recorded: false,
    topicsMatched: false,
    matchedTopics: [],
    matchedCatchphrases: [],
    catchphrasesUpdated: null,
    profileUpdated: false,
    interestReinforced: false,
    ...partial,
  };
}

/**
 * 处理用户反馈（飞书表情互动入口）。
 *
 * 链路：记录反馈 → 查消息-主题映射 → 更新画像 → 强化兴趣 → 更新心情
 *
 * @param type - 'like' | 'dislike'
 * @param messageId - 飞书消息 ID
 * @param userId - 用户 open_id
 */
export async function processFeedback(
  type: 'like' | 'dislike',
  messageId?: string,
  userId?: string,
  opts: { topics?: string[]; catchphrases?: string[] } = {},
): Promise<FeedbackProcessResult> {
  const result = emptyResult();

  // Step 1: 记录反馈到 feedback-store
  // 反馈丢失 = 用户表达未落盘，必须上抛（禁兜底）——否则 HTTP 200 假成功
  await recordFeedback({ type, messageId, userId });
  result.recorded = true;

  const topics = resolveFeedbackTopics(type, messageId, opts, result);
  attributeCatchphrases(type, messageId, opts, result);

  // Step 3: 更新用户画像 + 兴趣图谱
  if (topics && topics.length > 0) {
    result.profileUpdated = await updateProfileForFeedback(type, topics);
    try {
      result.interestReinforced = await updateGraphForFeedback(type, topics);
    } catch (error) {
      logger.error('兴趣图谱操作失败', { error, type, topics });
      throw error;
    }
  }

  // Step 4: 更新 Agent 心情
  try {
    await updateMoodByFeedback(type);
  } catch (error) {
    logger.error('更新心情失败', { error });
  }

  logger.info('反馈管道处理完成', {
    type,
    messageId,
    topicsMatched: result.topicsMatched,
    matchedTopics: result.matchedTopics,
    profileUpdated: result.profileUpdated,
    interestReinforced: result.interestReinforced,
  });

  return result;
}

/**
 * 顶话题（S9，#76）：显式"我要更多这个方向"。
 *
 * 与点赞走同一存储/画像/图谱管道，差异：
 * - type=boost（节流在控制面按 plan 做，管道本身无限制）
 * - 走统一多信号公式，强度 SIGNAL_STRENGTH.boost=2.0 > like=1.0（S2 #151）
 * - 新话题以 source=feedback 入图（种子 FEEDBACK_SEED_WEIGHT）
 */
export async function boostTopic(
  topic: string,
  userId?: string,
): Promise<FeedbackProcessResult> {
  const result = emptyResult({
    topicsMatched: true,
    matchedTopics: [topic],
  });

  // Step 1: 记录（type=boost）——配额语义核心：记录失败必须上抛，
  // 否则路由按 exit 0 保留 lastBoostAt（配额 consumed 但无任何落盘）
  await recordFeedback({ type: 'boost', userId });
  result.recorded = true;

  // Step 2: 画像更新（按 like 语义——正向偏好）；失败容错（同 processFeedback）
  try {
    await updateUserProfileBatch([{ type: 'like', topic }]);
    result.profileUpdated = true;
  } catch (error) {
    logger.error('顶话题更新用户画像失败', { error, topic });
  }

  // Step 3: 图谱强化（不存在则 feedback 来源入图）——persist 失败上抛
  try {
    const graph = getInterestGraph();
    if (!graph.isInitialized() && graph.getNodeCount() === 0) {
      await graph.load();
    }
    if (!graph.getNode(topic)) {
      graph.addInterest(topic, FEEDBACK_SEED_WEIGHT, 'feedback');
    }
    // S2 #151：boost 走统一多信号公式（SIGNAL_STRENGTH.boost = 2.0）
    graph.applySignal(topic, 'boost');
    result.interestReinforced = true;
    await graph.persist();
    // S2 #151：反馈后增量重生成 profile-summary
    await regenerateProfileSummary(graph);
  } catch (error) {
    logger.error('顶话题图谱强化失败', { error, topic });
    throw error;
  }

  // Step 4: 心情（按 like 语义）
  try {
    await updateMoodByFeedback('like');
  } catch (error) {
    logger.error('顶话题更新心情失败', { error });
  }

  logger.info('顶话题处理完成', { topic, reinforced: result.interestReinforced });
  return result;
}

/**
 * 获取当前消息-主题映射大小（用于测试/监控）。
 */
export function getMessageTopicMapSize(): number {
  return messageTopicMap.size;
}

/**
 * 清空消息-主题映射（仅用于测试）。
 */
export function _clearMessageTopicMap(): void {
  messageTopicMap.clear();
}
