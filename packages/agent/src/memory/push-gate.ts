/**
 * 推送价值门控（PushGate）
 *
 * Phase 5 (PUSH-01/02)：speak 前的价值评估——内容 × 兴趣图谱 × 用户画像 → 推送价值分。
 * 低于阈值则"只学不推"，替代无条件推送。
 *
 * 评分公式:
 *   pushScore = w1 × interestRelevance + w2 × userPreference + w3 × contentQuality
 *   默认权重: 0.4 / 0.4 / 0.2
 *
 * 阈值校准 (PUSH-02):
 *   跟踪最近窗口内推送的点赞/踩率，自动微调阈值。
 *   高点赞率 → 阈值微降（更宽松），高踩率 → 阈值微升（更严格）。
 */

import { z } from 'zod';
import { consola } from '../logger.js';
import { getInterestGraph } from './interest-graph.js';
import { loadUserProfile } from './user-profile.js';
import { loadFeedbacks } from './feedback-store.js';

const logger = consola.withTag('PushGate');

// ============================================
// Zod 校验（防 schema 漂移）
// ============================================

export const PushGateWeightsSchema = z.object({
  interestRelevance: z.number().min(0).max(1),
  userPreference: z.number().min(0).max(1),
  contentQuality: z.number().min(0).max(1),
});

export const PushGateCalibrationSchema = z.object({
  enabled: z.boolean(),
  windowSize: z.number().int().min(5).max(100),
  likeRateHigh: z.number().min(0.5).max(1),
  dislikeRateHigh: z.number().min(0.1).max(0.5),
  adjustStep: z.number().min(0.01).max(0.2),
});

export const PushGateContentScanSchema = z.object({
  enabled: z.boolean(),
  maxUrlCount: z.number().int().min(1).max(20),
});

export const PushGateConfigSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().min(0).max(1),
  weights: PushGateWeightsSchema,
  calibration: PushGateCalibrationSchema,
  contentScan: PushGateContentScanSchema,
});

// ============================================
// Types
// ============================================

export interface PushGateWeights {
  interestRelevance: number;
  userPreference: number;
  contentQuality: number;
}

export interface PushGateCalibration {
  enabled: boolean;
  /** 校准窗口（最近 N 次推送） */
  windowSize: number;
  /** 点赞率高于此值时降低阈值（更宽松） */
  likeRateHigh: number;
  /** 踩率高于此值时提高阈值（更严格） */
  dislikeRateHigh: number;
  /** 每次微调步长 */
  adjustStep: number;
}

export interface PushGateContentScan {
  enabled: boolean;
  /** 内容中允许的最大 URL 数量 */
  maxUrlCount: number;
}

export interface PushGateConfig {
  enabled: boolean;
  threshold: number;
  weights: PushGateWeights;
  calibration: PushGateCalibration;
  contentScan: PushGateContentScan;
}

/** speak 内容类型。与 src/tools/push/speak.ts 的 SpeakType 同步保持。 */
export type SpeakType = 'share' | 'nonsense' | 'article';

/** 门控评估因子 */
export interface PushGateFactors {
  interestRelevance: number;
  userPreference: number;
  contentQuality: number;
  /** 内容扫描发现的警告 */
  contentWarnings: string[];
}

/** 门控评估结果 */
export interface PushGateResult {
  /** 综合推送价值分 0-1 */
  score: number;
  /** 是否通过门控（可推送） */
  passed: boolean;
  /** 当前阈值 */
  threshold: number;
  /** 各因子得分 */
  factors: PushGateFactors;
  /** 决策理由（人类可读） */
  reasons: string[];
  /** 内容实际命中的兴趣节点 ID，供反馈归因使用 */
  matchedTopics: string[];
}

// ============================================
// 默认配置
// ============================================

export const DEFAULT_PUSH_GATE_CONFIG: PushGateConfig = {
  enabled: true,
  threshold: 0.5,
  // 三者之和应为 1.0，否则综合分可能超出 [0,1] 后被 clamp 截断
  weights: {
    interestRelevance: 0.4,
    userPreference: 0.4,
    contentQuality: 0.2,
  },
  calibration: {
    enabled: true,
    windowSize: 20,
    likeRateHigh: 0.7,
    dislikeRateHigh: 0.3,
    adjustStep: 0.05,
  },
  contentScan: {
    enabled: true,
    maxUrlCount: 5,
  },
};

/** 阈值允许范围 */
const THRESHOLD_MIN = 0.3;
const THRESHOLD_MAX = 0.8;

// ============================================
// Prompt injection 检测特征
// ============================================

/** 可疑的 prompt injection 模式 */
const INJECTION_PATTERNS = [
  /忽略(以上|之前|所有).*(指令|规则|限制)/i,
  /ignore (above|previous|all).*(instruction|rule|constraint)/i,
  /system\s*(prompt|message|instruction)/i,
  /you are now/i,
  /从现在开始.*你是/i,
  /忘记.*身份/i,
  /扮演.*角色/i,
  /\[INST\]/,
  /<\/?instruction>/,
  /:::\s*(system|instruction)/,
];

// ============================================
// 兴趣词匹配
// ============================================

/** 需要词边界保护的 ASCII 兴趣词长度上限 */
const SHORT_ASCII_MAX_LEN = 4;

/** 纯 ASCII 字母数字 */
const ASCII_WORD_RE = /^[a-z0-9]+$/i;

/**
 * 内容是否命中某个兴趣词。
 *
 * 短 ASCII 词用子串匹配会大量误命中——"AI" 会命中 said、maintain、explain，
 * 使得毫不相关的英文内容也拿到兴趣分。对这类词改用词边界匹配。
 * 中文不适用词边界（\b 在 CJK 字符间不成立），保持子串匹配。
 */
export function matchInterest(contentLower: string, interestId: string): boolean {
  const idLower = interestId.toLowerCase();

  if (idLower.length <= SHORT_ASCII_MAX_LEN && ASCII_WORD_RE.test(idLower)) {
    return new RegExp(`\\b${idLower}\\b`).test(contentLower);
  }

  return contentLower.includes(idLower);
}

// ============================================
// PushGate
// ============================================

export class PushGate {
  private config: PushGateConfig;

  constructor(config?: Partial<PushGateConfig>) {
    this.config = { ...DEFAULT_PUSH_GATE_CONFIG, ...config };
  }

  /**
   * 评估内容推送价值。
   *
   * 不抛错——门控失败默认放行（不阻断 speak 热路径）。
   *
   * @param content - speak 内容
   * @param type - 内容类型
   * @returns 门控评估结果
   */
  async evaluate(content: string, type: SpeakType): Promise<PushGateResult> {
    const reasons: string[] = [];

    if (!this.config.enabled) {
      return {
        score: 1.0,
        passed: true,
        threshold: this.config.threshold,
        factors: { interestRelevance: 0, userPreference: 0, contentQuality: 0, contentWarnings: [] },
        reasons: ['门控已禁用'],
        matchedTopics: [],
      };
    }

    // 内容扫描（在评分前执行，可能产生警告和降权）
    const contentWarnings = this.scanContent(content);

    // 计算各因子得分（每个因子 0-1，失败时返回 0.5 中性分）
    const { score: interestRelevance, matched: matchedTopics } =
      await this.scoreInterestRelevance(content);
    const userPreference = await this.scoreUserPreference(content);
    const contentQuality = this.scoreContentQuality(content, type);

    // 加权综合
    const { weights } = this.config;
    let score =
      weights.interestRelevance * interestRelevance +
      weights.userPreference * userPreference +
      weights.contentQuality * contentQuality;

    // 内容安全降权：有 injection 警告时额外扣分
    if (contentWarnings.length > 0) {
      const penalty = Math.min(0.5, contentWarnings.length * 0.15);
      score = Math.max(0, score - penalty);
      reasons.push(`内容安全警告 ${contentWarnings.length} 条，扣分 ${penalty.toFixed(2)}`);
    }

    // 确保 score 在 [0, 1]
    score = Math.max(0, Math.min(1, score));

    const passed = score >= this.config.threshold;

    // 组装理由
    reasons.unshift(
      `兴趣相关度=${interestRelevance.toFixed(2)}`,
      `用户偏好=${userPreference.toFixed(2)}`,
      `内容质量=${contentQuality.toFixed(2)}`,
    );

    logger.info('PushGate 评估完成', {
      score: score.toFixed(3),
      passed,
      threshold: this.config.threshold,
      type,
      contentLen: content.length,
      factors: { interestRelevance, userPreference, contentQuality },
      warnings: contentWarnings.length,
      matchedTopics,
    });

    return {
      score,
      passed,
      threshold: this.config.threshold,
      factors: { interestRelevance, userPreference, contentQuality, contentWarnings },
      reasons,
      matchedTopics,
    };
  }

  /**
   * 在线阈值校准。
   *
   * 基于最近窗口内的推送反馈率微调阈值：
   * - 高点赞率 → 降低阈值（更宽松，我们可能太严格了）
   * - 高踩率 → 提高阈值（更严格，我们在推不感兴趣的内容）
   *
   * 阈值被限制在 [THRESHOLD_MIN, THRESHOLD_MAX] 范围内。
   *
   * @returns 校准后的新阈值
   */
  async calibrate(): Promise<number> {
    if (!this.config.calibration.enabled) {
      return this.config.threshold;
    }

    try {
      const feedbacks = await loadFeedbacks({ limit: this.config.calibration.windowSize });
      const total = feedbacks.length;

      if (total < 5) {
        // 样本不足，不校准
        logger.debug('阈值校准跳过：反馈样本不足', { total });
        return this.config.threshold;
      }

      const likes = feedbacks.filter((f) => f.type === 'like').length;
      const dislikes = feedbacks.filter((f) => f.type === 'dislike').length;
      const likeRate = likes / total;
      const dislikeRate = dislikes / total;

      const oldThreshold = this.config.threshold;
      let newThreshold = oldThreshold;

      if (likeRate >= this.config.calibration.likeRateHigh) {
        // 点赞率高 → 降低阈值（更宽松）
        newThreshold = Math.max(THRESHOLD_MIN, oldThreshold - this.config.calibration.adjustStep);
        logger.info('阈值校准：高点赞率，降低阈值', {
          likeRate: likeRate.toFixed(2),
          oldThreshold: oldThreshold.toFixed(3),
          newThreshold: newThreshold.toFixed(3),
          sampleSize: total,
        });
      } else if (dislikeRate >= this.config.calibration.dislikeRateHigh) {
        // 踩率高 → 提高阈值（更严格）
        newThreshold = Math.min(THRESHOLD_MAX, oldThreshold + this.config.calibration.adjustStep);
        logger.info('阈值校准：高踩率，提高阈值', {
          dislikeRate: dislikeRate.toFixed(2),
          oldThreshold: oldThreshold.toFixed(3),
          newThreshold: newThreshold.toFixed(3),
          sampleSize: total,
        });
      } else {
        logger.debug('阈值校准：反馈率在正常范围，无需调整', {
          likeRate: likeRate.toFixed(2),
          dislikeRate: dislikeRate.toFixed(2),
          threshold: oldThreshold.toFixed(3),
        });
      }

      this.config.threshold = newThreshold;
      return newThreshold;
    } catch (error) {
      logger.warn('阈值校准失败，保持当前阈值', { error });
      return this.config.threshold;
    }
  }

  /** 获取当前配置（只读） */
  getConfig(): Readonly<PushGateConfig> {
    return this.config;
  }

  /**
   * 更新阈值（用于测试和外部校准）。
   * 自动限制在 [THRESHOLD_MIN, THRESHOLD_MAX]。
   */
  setThreshold(value: number): void {
    this.config.threshold = Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, value));
  }

  // ==========================================
  // 评分子维度
  // ==========================================

  /**
   * 兴趣相关度评分。
   *
   * 内容与 InterestGraph 的 top 兴趣节点匹配，返回加权匹配分（0-1）
   * 及实际命中的节点 ID。
   * 图谱不可用或尚无判别力时返回中性分 0.5。
   */
  private async scoreInterestRelevance(
    content: string,
  ): Promise<{ score: number; matched: string[] }> {
    try {
      const graph = getInterestGraph();
      if (!graph.isInitialized() && graph.getNodeCount() === 0) {
        await graph.load();
      }

      const nodes = graph.getTopInterestsWithWeights(10, 0.05);
      const contentLower = content.toLowerCase();
      const matched: string[] = [];
      let matchedWeight = 0;
      let totalWeight = 0;

      for (const node of nodes) {
        totalWeight += node.weight;
        if (matchInterest(contentLower, node.id)) {
          matchedWeight += node.weight;
          matched.push(node.id);
        }
      }

      // 只有等权默认种子时，权重占比恒为固定几档，继续打分只会把所有内容
      // 锁在门外（冷启动死锁）。命中列表仍照常返回——它是反馈归因的依据，
      // 缺了它点赞无法强化任何节点，图谱将永远无法分化。
      if (totalWeight === 0 || !graph.isDifferentiated()) {
        return { score: 0.5, matched };
      }

      return { score: matchedWeight / totalWeight, matched };
    } catch (error) {
      logger.warn('兴趣相关度评分失败，返回中性分', { error });
      return { score: 0.5, matched: [] };
    }
  }

  /**
   * 用户偏好评分。
   *
   * 匹配内容与 UserProfile 的 likes/dislikes。
   * - 基础分 0.5（中性）
   * - 每命中一个 like: +0.15（上限 +0.4）
   * - 每命中一个 dislike: -0.2（下限 0）
   * - 置信度调节：confidence 越高，偏好匹配的影响越大
   *
   * UserProfile 不可用时返回中性分 0.5。
   */
  private async scoreUserPreference(content: string): Promise<number> {
    try {
      const profile = await loadUserProfile();
      const contentLower = content.toLowerCase();

      let score = 0.5;

      // 匹配喜欢的话题
      const matchedLikes = profile.likes.filter((l) =>
        contentLower.includes(l.toLowerCase()),
      );
      // 匹配不喜欢的话题
      const matchedDislikes = profile.dislikes.filter((d) =>
        contentLower.includes(d.toLowerCase()),
      );

      // 基础调整
      score += Math.min(0.4, matchedLikes.length * 0.15);
      score -= Math.min(0.5, matchedDislikes.length * 0.2);

      // 置信度调节：低置信度时向 0.5 回归（反馈少 → 偏好不可靠）
      if (profile.confidence > 0) {
        const neutralPull = 1 - profile.confidence;
        score = score * profile.confidence + 0.5 * neutralPull;
      }

      return Math.max(0, Math.min(1, score));
    } catch (error) {
      logger.warn('用户偏好评分失败，返回中性分', { error });
      return 0.5;
    }
  }

  /**
   * 内容质量评分。
   *
   * 基于类型、长度、URL 数量。
   * - article: 0.8 / share: 0.6 / nonsense: 0.4
   * - 有 URL: +0.05
   * - 长度 > 100: +0.05，> 300: +0.1
   * 警告降权由 evaluate 的全局 penalty 统一处理。
   */
  private scoreContentQuality(content: string, type: SpeakType): number {
    const typeScore: Record<SpeakType, number> = {
      article: 0.8,
      share: 0.6,
      nonsense: 0.4,
    };

    let score = typeScore[type];

    // URL 加分
    if (/https?:\/\//.test(content)) {
      score += 0.05;
    }

    // 长度加分
    const len = content.length;
    if (len > 300) {
      score += 0.1;
    } else if (len > 100) {
      score += 0.05;
    }

    return Math.max(0, Math.min(1, score));
  }

  // ==========================================
  // 内容扫描
  // ==========================================

  /**
   * 扫描内容安全问题。
   *
   * 检查项：
   * - URL 数量异常（可能是链接轰炸）
   * - Prompt injection 特征（试图操控 LLM）
   *
   * @returns 警告列表
   */
  private scanContent(content: string): string[] {
    const warnings: string[] = [];

    if (!this.config.contentScan.enabled) {
      return warnings;
    }

    // URL 数量检查
    const urlMatches = content.match(/https?:\/\/[^\s]+/g);
    const urlCount = urlMatches?.length ?? 0;
    if (urlCount > this.config.contentScan.maxUrlCount) {
      warnings.push(`URL 数量异常 (${urlCount} > ${this.config.contentScan.maxUrlCount})`);
    }

    // Prompt injection 检测
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        warnings.push(`检测到可疑注入模式: ${pattern.source}`);
        break; // 只报告一次（第一个匹配）
      }
    }

    if (warnings.length > 0) {
      logger.warn('PushGate 内容扫描发现问题', {
        urlCount,
        warningCount: warnings.length,
        contentPreview: content.slice(0, 80),
      });
    }

    return warnings;
  }
}

// ============================================
// 单例
// ============================================

/** 按 cfg 键化（租户模式各租户门控配置独立实例） */
const gateCache = new Map<string, PushGate>();

export function getPushGate(cfg?: Partial<PushGateConfig>): PushGate {
  const key = JSON.stringify(cfg ?? {});
  if (!gateCache.has(key)) {
    gateCache.set(key, new PushGate(cfg));
  }
  return gateCache.get(key)!;
}

/** 重置单例（测试隔离） */
export function _resetPushGate(): void {
  gateCache.clear();
}
