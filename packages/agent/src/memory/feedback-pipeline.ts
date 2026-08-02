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
import { updateMoodByFeedback } from '../agent/state.js';
import { sessionStats } from '../tui/index.js';

const logger = consola.withTag('FeedbackPipeline');

/** 点赞强化权重增量 */
const LIKE_REINFORCE_DELTA = 0.1;

/** 踩的权重衰减 */
const DISLIKE_DECAY_DELTA = 0.1;

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
  /** 画像是否已更新 */
  profileUpdated: boolean;
  /** 兴趣是否已强化 */
  interestReinforced: boolean;
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
): Promise<FeedbackProcessResult> {
  const result: FeedbackProcessResult = {
    recorded: false,
    topicsMatched: false,
    matchedTopics: [],
    profileUpdated: false,
    interestReinforced: false,
  };

  // Step 1: 记录反馈到 feedback-store
  try {
    await recordFeedback({ type, messageId, userId });
    result.recorded = true;
    sessionStats.recordFeedback(type);
  } catch (error) {
    logger.error('记录反馈失败', { error });
    // 记录失败不阻断后续链路
  }

  // Step 2: 查消息-兴趣主题映射
  const topics = messageId ? messageTopicMap.get(messageId) : undefined;
  if (topics && topics.length > 0) {
    result.topicsMatched = true;
    result.matchedTopics = topics;
    logger.info('反馈匹配到兴趣主题', { type, messageId, topics });
  } else {
    logger.debug('反馈未匹配到兴趣主题（可能是旧消息或映射已清理）', { messageId });
  }

  // Step 3: 更新用户画像 + 兴趣图谱
  if (topics && topics.length > 0) {
    // 3a: 批量更新用户画像（一次 I/O）
    const profileEntries: ProfileUpdateEntry[] = topics.map((topic) => ({
      type,
      topic,
    }));
    try {
      await updateUserProfileBatch(profileEntries);
      result.profileUpdated = true;
    } catch (error) {
      logger.error('批量更新用户画像失败', { error, type, topics });
    }

    // 3b: 强化/衰减兴趣图谱
    try {
      const graph = getInterestGraph();
      // 确保 graph 已初始化
      if (!graph.isInitialized() && graph.getNodeCount() === 0) {
        await graph.load();
      }

      for (const topic of topics) {
        if (type === 'like') {
          // 点赞：检查节点是否存在，不存在则先创建
          if (!graph.getNode(topic)) {
            graph.addInterest(topic, 0.3, 'feedback');
          }
          graph.reinforce(topic, LIKE_REINFORCE_DELTA);
          result.interestReinforced = true;
        } else {
          // 踩：衰减兴趣（不删除，让时间衰减自然处理）
          const node = graph.getNode(topic);
          if (node) {
            const newWeight = Math.max(0, node.weight - DISLIKE_DECAY_DELTA);
            if (newWeight > 0) {
              node.weight = newWeight;
              node.lastReinforced = new Date().toISOString();
              result.interestReinforced = true;
            }
          }
        }
      }

      // 所有 topic 处理完后一次持久化（N 个 topic → 1 次原子写）
      await graph.persist();
    } catch (error) {
      logger.error('兴趣图谱操作失败', { error, type, topics });
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
