/**
 * 推送上下文（模块沿用 push-gate 遗留名——配置键 `pushGate` 已部署在
 * 各租户 agent-config.json，改名会破坏存量配置）
 *
 * 门控 P3（ADR-0010 / #152）后，本模块不再做价值评分与阈值拦截——
 * speak 是否推送由 LLM 在 ReAct 循环内自判断。这里只剩两件确定性工作：
 * - 内容扫描（scanContentWarnings）：prompt injection 特征 / URL 数量异常，
 *   供 quality hook 做安全护栏与留痕
 * - 话题归因（attributeTopics）：内容命中的图谱话题，随 speak 落盘供反馈
 *   归因（S2 Phase A；S4 分类管线 contentTopics 落地后逐步替代）
 */

import { z } from 'zod';
import { consola } from '../logger.js';
import { getInterestGraph } from './interest-graph.js';

const logger = consola.withTag('PushGate');

// ============================================
// Zod 校验（防 schema 漂移）
// ============================================

export const PushGateContentScanSchema = z.object({
  enabled: z.boolean(),
  maxUrlCount: z.number().int().min(1).max(20),
});

export const PushGateConfigSchema = z.object({
  enabled: z.boolean(),
  /** 每次游荡最多 speak 次数（工具层护栏，防话痨；0 = 不限） */
  maxSpeaksPerWander: z.number().int().min(0).max(20),
  contentScan: PushGateContentScanSchema,
});

// ============================================
// Types
// ============================================

export interface PushGateContentScan {
  enabled: boolean;
  /** 内容中允许的最大 URL 数量 */
  maxUrlCount: number;
}

export interface PushGateConfig {
  enabled: boolean;
  maxSpeaksPerWander: number;
  contentScan: PushGateContentScan;
}

/** speak 内容类型。与 src/tools/push/speak.ts 的 SpeakType 同步保持。 */
export type SpeakType = 'share' | 'nonsense' | 'article';

// ============================================
// 默认配置
// ============================================

export const DEFAULT_PUSH_GATE_CONFIG: PushGateConfig = {
  enabled: true,
  // 防话痨护栏：单次游荡 3 条足够覆盖"一次分享 + 一次碎碎念"的合理上限
  maxSpeaksPerWander: 3,
  contentScan: {
    enabled: true,
    maxUrlCount: 5,
  },
};

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
// 内容扫描
// ============================================

/**
 * 扫描内容安全问题。
 *
 * 检查项：
 * - URL 数量异常（可能是链接轰炸）→ 警告（价值判断仍归 LLM）
 * - Prompt injection 特征（试图操控 LLM）→ hasInjection 标记（quality hook
 *   据此 deny——确定性安全护栏，不交给 LLM 判断）
 */
export interface ContentScanResult {
  warnings: string[];
  /** prompt injection 特征命中（安全红线，quality hook 据此 deny） */
  hasInjection: boolean;
}

export function scanContentWarnings(
  content: string,
  scan: PushGateContentScan,
): ContentScanResult {
  const warnings: string[] = [];
  let hasInjection = false;

  if (!scan.enabled) {
    return { warnings, hasInjection };
  }

  // URL 数量检查
  const urlMatches = content.match(/https?:\/\/[^\s]+/g);
  const urlCount = urlMatches?.length ?? 0;
  if (urlCount > scan.maxUrlCount) {
    warnings.push(`URL 数量异常 (${urlCount} > ${scan.maxUrlCount})`);
  }

  // Prompt injection 检测
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(`检测到可疑注入模式: ${pattern.source}`);
      hasInjection = true;
      break; // 只报告一次（第一个匹配）
    }
  }

  if (warnings.length > 0) {
    logger.warn('内容扫描发现问题', {
      urlCount,
      warningCount: warnings.length,
      contentPreview: content.slice(0, 80),
    });
  }

  return { warnings, hasInjection };
}

// ============================================
// 话题归因
// ============================================

/** 归因扫描的图谱节点数与最低权重（与旧评分维同参数，仅去打分） */
const ATTRIBUTION_TOP_N = 10;
const ATTRIBUTION_MIN_WEIGHT = 0.05;

/**
 * 内容命中的图谱话题（反馈归因依据，S2 Phase A）。
 *
 * 只做匹配不打分——命中列表跟随 speak 落盘，反馈时按 messageId 反查精确
 * 加权到叶子。图谱不可用时返回 []（归因是 best-effort：失败只影响本次
 * 反馈强化，不值得阻断推送本身）。
 */
export async function attributeTopics(content: string): Promise<string[]> {
  try {
    const graph = getInterestGraph();
    if (!graph.isInitialized() && graph.getNodeCount() === 0) {
      await graph.load();
    }

    const nodes = graph.getTopInterestsWithWeights(ATTRIBUTION_TOP_N, ATTRIBUTION_MIN_WEIGHT);
    const contentLower = content.toLowerCase();
    const matched: string[] = [];
    for (const node of nodes) {
      if (matchInterest(contentLower, node.id)) {
        matched.push(node.id);
      }
    }
    return matched;
  } catch (error) {
    logger.warn('话题归因失败，返回空列表', { error });
    return [];
  }
}
