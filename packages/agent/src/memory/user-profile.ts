import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { z } from 'zod';
import { consola } from '../logger.js';

const logger = consola.withTag('UserProfile');

/** F5：调用时解析，不在 import 期冻结 DATA_DIR */
function getUserProfilePath(): string {
  return `${process.env.DATA_DIR ?? 'data'}/memory/user-profile.json`;
}

/** 单个话题最多保留的喜欢/不喜欢条目数 */
const MAX_TOPIC_ITEMS = 20;

/** 画像修改冷却时间（毫秒） */
const PROFILE_UPDATE_COOLDOWN_MS = 30 * 60 * 1000;

/** 置信度 sigmoid 参数 K：sampleCount/(sampleCount+K)，K=10 */
const CONFIDENCE_K = 10;

/** 置信度上限 */
const CONFIDENCE_CAP = 0.95;

// ============================================
// 原子写（与 interest-graph.ts 统一模式）
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
// Zod Schema（防 schema 漂移）
// ============================================

export const UserProfileSchema = z.object({
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  lastUpdated: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
    message: 'lastUpdated must be a valid date string',
  }),
  /** @deprecated 由 sampleCount 替代，保留以兼容旧数据 */
  feedbackCount: z.number().int().min(0),
  /**
   * 不封顶的样本计数，用于置信度校准。
   * .catch(0) 兼容旧数据：v1 格式无此字段，解析时回退为 0，
   * 随后由 loadUserProfile 从 feedbackCount 迁移。
   */
  sampleCount: z.number().int().min(0).catch(0),
  confidence: z.number().min(0).max(1),
  /** 上次画像修改时间，null 表示从未修改 */
  lastProfileUpdateAt: z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), {
      message: 'lastProfileUpdateAt must be a valid date string',
    })
    .nullable(),
});

// ============================================
// Types
// ============================================

/** 用户画像数据结构 */
export interface UserProfile {
  likes: string[];
  dislikes: string[];
  lastUpdated: string;
  /** @deprecated 由 sampleCount 替代，保留以兼容旧数据 */
  feedbackCount: number;
  /** 不封顶的样本计数，用于置信度校准（sigmoid） */
  sampleCount: number;
  /** 置信度 0-1，公式 sampleCount/(sampleCount+K)，K=10 */
  confidence: number;
  /** 上次画像修改时间（用于冷却期控制） */
  lastProfileUpdateAt: string | null;
}

// ============================================
// 工厂 / 加载 / 持久化
// ============================================

/** 默认用户画像 */
function createDefaultUserProfile(): UserProfile {
  return {
    likes: [],
    dislikes: [],
    lastUpdated: new Date().toISOString(),
    feedbackCount: 0,
    sampleCount: 0,
    confidence: 0,
    lastProfileUpdateAt: null,
  };
}

/**
 * 加载用户画像。
 *
 * 文件不存在 → 返回默认画像（首次运行，合法）。
 * 文件存在但解析/schema 失败 → 抛错（D-09：不兜底，不掩错误）。
 */
export async function loadUserProfile(): Promise<UserProfile> {
  const profilePath = getUserProfilePath();
  if (!existsSync(profilePath)) {
    logger.debug('用户画像文件不存在，使用默认画像');
    return createDefaultUserProfile();
  }

  let content: string;
  try {
    content = await readFile(profilePath, 'utf-8');
  } catch (error) {
    logger.error('读取用户画像文件失败', { path: profilePath, error });
    throw new Error(`用户画像读取失败: ${profilePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    logger.error('用户画像解析失败（非法 JSON）', { path: profilePath, error });
    throw new Error(`用户画像解析失败: ${profilePath}`, { cause: error });
  }

  const result = UserProfileSchema.safeParse(parsed);
  if (!result.success) {
    logger.error('用户画像 schema 校验失败', {
      path: profilePath,
      issues: result.error.issues,
    });
    throw new Error(`用户画像 schema 校验失败: ${profilePath}`, {
      cause: result.error,
    });
  }

  // 兼容旧数据：如果没有 sampleCount 字段，从 feedbackCount 迁移
  const data = result.data;
  if (data.sampleCount === 0 && data.feedbackCount > 0) {
    data.sampleCount = data.feedbackCount;
  }

  return data;
}

/**
 * 保存用户画像
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    await atomicWriteJson(getUserProfilePath(), profile);
    logger.debug('用户画像已保存');
  } catch (error) {
    logger.error('保存用户画像失败', { error });
    throw error;
  }
}

// ============================================
// 置信度计算
// ============================================

/**
 * 计算置信度（sigmoid 校准）。
 *
 * 公式: confidence = min(CAP, sampleCount / (sampleCount + K))
 * K=10 意味着：1 样本 → 9%，5 → 33%，10 → 50%，50 → 83%
 * 小样本不致锁死方向，大样本渐近收敛到 CAP。
 */
function computeConfidence(sampleCount: number): number {
  const raw = sampleCount / (sampleCount + CONFIDENCE_K);
  return Math.min(CONFIDENCE_CAP, raw);
}

// ============================================
// 画像更新
// ============================================

/**
 * 更新用户画像（基于反馈）。
 *
 * 每次反馈递增 sampleCount（不封顶），置信度由 sigmoid 公式校准。
 * feedbackCount 保留递增以兼容旧读取端。
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
    // 添加到喜欢列表（避免重复，限制数量）
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

  profile.feedbackCount += 1;
  profile.sampleCount += 1;
  profile.lastUpdated = new Date().toISOString();
  profile.confidence = computeConfidence(profile.sampleCount);

  await saveUserProfile(profile);

  logger.info('用户画像已更新', {
    type,
    topic,
    likesCount: profile.likes.length,
    dislikesCount: profile.dislikes.length,
    sampleCount: profile.sampleCount,
    confidence: profile.confidence,
  });

  return profile;
}

/** 批量画像更新的单条条目 */
export interface ProfileUpdateEntry {
  type: 'like' | 'dislike';
  topic: string;
}

/**
 * 批量更新用户画像（一次 I/O）。
 *
 * 多个反馈话题共享同一次 load + save，避免 N 次反馈 → N 次文件读写。
 * sampleCount 每个话题分别递增，confidence 最终算一次。
 *
 * @param entries - 一个反馈中涉及的多个话题
 */
export async function updateUserProfileBatch(
  entries: ProfileUpdateEntry[],
): Promise<UserProfile> {
  const profile = await loadUserProfile();

  for (const { type, topic } of entries) {
    if (type === 'like') {
      profile.dislikes = profile.dislikes.filter(
        (d) => d.toLowerCase() !== topic.toLowerCase(),
      );
      if (!profile.likes.some((l) => l.toLowerCase() === topic.toLowerCase())) {
        profile.likes = [...profile.likes, topic].slice(-MAX_TOPIC_ITEMS);
      }
    } else {
      profile.likes = profile.likes.filter(
        (l) => l.toLowerCase() !== topic.toLowerCase(),
      );
      if (!profile.dislikes.some((d) => d.toLowerCase() === topic.toLowerCase())) {
        profile.dislikes = [...profile.dislikes, topic].slice(-MAX_TOPIC_ITEMS);
      }
    }

    profile.feedbackCount += 1;
    profile.sampleCount += 1;
  }

  profile.lastUpdated = new Date().toISOString();
  profile.confidence = computeConfidence(profile.sampleCount);

  await saveUserProfile(profile);

  logger.info('用户画像已批量更新', {
    entryCount: entries.length,
    topics: entries.map((e) => e.topic),
    sampleCount: profile.sampleCount,
    confidence: profile.confidence,
  });

  return profile;
}

/** tryUpdateUserProfile 返回值 */
export interface ProfileUpdateResult {
  success: boolean;
  reason?: string;
  profile?: UserProfile;
}

/**
 * 尝试更新用户画像（Agent 观察触发，带硬限制）。
 *
 * 限制：
 * - 30 分钟冷却期
 * - 每次 add 1 条，不删不改已有条目
 *
 * @param type - 'like' | 'dislike'
 * @param topic - 话题
 * @param reasoning - 修改理由（日志用）
 */
export async function tryUpdateUserProfile(
  type: 'like' | 'dislike',
  topic: string,
  reasoning: string,
): Promise<ProfileUpdateResult> {
  const trimmedTopic = topic.trim();
  const profile = await loadUserProfile();

  // 冷却期检查
  if (profile.lastProfileUpdateAt) {
    const elapsed = Date.now() - new Date(profile.lastProfileUpdateAt).getTime();
    if (elapsed < PROFILE_UPDATE_COOLDOWN_MS) {
      const remainingMin = Math.ceil((PROFILE_UPDATE_COOLDOWN_MS - elapsed) / 60000);
      logger.debug('画像修改被冷却期拒绝', {
        type,
        topic: trimmedTopic,
        reasoning,
        remainingMin,
      });
      return {
        success: false,
        reason: `画像修改冷却中，还需等待约 ${remainingMin} 分钟`,
      };
    }
  }

  // 每次只加 1 条
  if (type === 'like') {
    if (!profile.likes.some((l) => l.toLowerCase() === trimmedTopic.toLowerCase())) {
      profile.likes = [...profile.likes, trimmedTopic].slice(-MAX_TOPIC_ITEMS);
    }
    profile.dislikes = profile.dislikes.filter(
      (d) => d.toLowerCase() !== trimmedTopic.toLowerCase(),
    );
  } else {
    if (!profile.dislikes.some((d) => d.toLowerCase() === trimmedTopic.toLowerCase())) {
      profile.dislikes = [...profile.dislikes, trimmedTopic].slice(-MAX_TOPIC_ITEMS);
    }
    profile.likes = profile.likes.filter(
      (l) => l.toLowerCase() !== trimmedTopic.toLowerCase(),
    );
  }

  profile.lastProfileUpdateAt = new Date().toISOString();
  profile.lastUpdated = new Date().toISOString();
  profile.feedbackCount += 1;
  profile.sampleCount += 1;
  profile.confidence = computeConfidence(profile.sampleCount);

  await saveUserProfile(profile);

  logger.info('用户画像已通过 Agent 观察更新', {
    type,
    topic: trimmedTopic,
    reasoning,
    confidence: profile.confidence,
    sampleCount: profile.sampleCount,
    likesCount: profile.likes.length,
    dislikesCount: profile.dislikes.length,
  });

  return { success: true, profile };
}
