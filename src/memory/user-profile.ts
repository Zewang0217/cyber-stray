import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { consola } from '../logger.js';

const logger = consola.withTag('memory');

/** 用户画像文件路径 */
const USER_PROFILE_PATH = 'data/memory/user-profile.json';

/** 最大反馈记录数量 */
const MAX_FEEDBACK_RECORDS = 50;

/** 单个话题最多保留的喜欢/不喜欢条目数 */
const MAX_TOPIC_ITEMS = 20;

/** 用户画像数据结构 */
export interface UserProfile {
  likes: string[];       // 用户喜欢的话题/内容类型
  dislikes: string[];    // 用户不喜欢的话题/内容类型
  lastUpdated: string;   // 最后更新时间 ISO 格式
  feedbackCount: number; // 累计反馈次数
  confidence: number;    // 置信度 0-1（反馈越多越高）
}

/** 默认用户画像 */
function createDefaultUserProfile(): UserProfile {
  return {
    likes: [],
    dislikes: [],
    lastUpdated: new Date().toISOString(),
    feedbackCount: 0,
    confidence: 0,
  };
}

/**
 * 加载用户画像
 * 文件不存在时返回默认画像
 */
export async function loadUserProfile(): Promise<UserProfile> {
  if (!existsSync(USER_PROFILE_PATH)) {
    logger.debug('用户画像文件不存在，使用默认画像');
    return createDefaultUserProfile();
  }

  try {
    const content = await readFile(USER_PROFILE_PATH, 'utf-8');
    const parsed = JSON.parse(content) as Partial<UserProfile>;
    return { ...createDefaultUserProfile(), ...parsed };
  } catch (error) {
    logger.error('读取用户画像失败，使用默认画像', { error });
    return createDefaultUserProfile();
  }
}

/**
 * 保存用户画像
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    await mkdir('data/memory', { recursive: true });
    await writeFile(USER_PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
    logger.debug('用户画像已保存');
  } catch (error) {
    logger.error('保存用户画像失败', { error });
    throw error;
  }
}

/**
 * 更新用户画像（基于反馈）
 *
 * @param type - 'like' | 'dislike'
 * @param topic - 用户反馈的话题
 */
export async function updateUserProfile(
  type: 'like' | 'dislike',
  topic: string,
): Promise<UserProfile> {
  const profile = await loadUserProfile();

  if (type === 'like') {
    // 从不喜欢列表中移除（可能改变主意了）
    profile.dislikes = profile.dislikes.filter(
      (d) => d.toLowerCase() !== topic.toLowerCase(),
    );
    // 添加到喜欢列表（避免重复）
    if (!profile.likes.some((l) => l.toLowerCase() === topic.toLowerCase())) {
      profile.likes = [...profile.likes, topic].slice(-MAX_TOPIC_ITEMS);
    }
  } else {
    // 从喜欢列表中移除
    profile.likes = profile.likes.filter(
      (l) => l.toLowerCase() !== topic.toLowerCase(),
    );
    // 添加到不喜欢列表
    if (!profile.dislikes.some((d) => d.toLowerCase() === topic.toLowerCase())) {
      profile.dislikes = [...profile.dislikes, topic].slice(-MAX_TOPIC_ITEMS);
    }
  }

  profile.feedbackCount = Math.min(profile.feedbackCount + 1, MAX_FEEDBACK_RECORDS);
  profile.lastUpdated = new Date().toISOString();
  // 置信度随反馈数线性提升，上限 0.95
  profile.confidence = Math.min(0.95, profile.feedbackCount / 20);

  await saveUserProfile(profile);

  logger.info('用户画像已更新', {
    type,
    topic,
    likesCount: profile.likes.length,
    dislikesCount: profile.dislikes.length,
    confidence: profile.confidence,
  });

  return profile;
}
