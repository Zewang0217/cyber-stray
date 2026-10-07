/**
 * 推送（speak）记录契约：agent 写 speaks JSONL 一行 → CP /api/history
 * 归一化透传 → web 渲染卡片。三方共用同一定义，禁止包内复制。
 */

import type { PetMood } from './pet-stats';

/** speak 内容类型 */
export type SpeakType = 'share' | 'nonsense' | 'article';

const MEME_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 表情包图鉴 ID 的唯一校验与鉴权图片路径构造。 */
export function getMemeImageUrl(value: unknown): string | undefined {
  return typeof value === 'string' && MEME_ID_RE.test(value)
    ? `/api/meme/${value}/image.png`
    : undefined;
}

const SPEAK_TYPES: readonly string[] = ['share', 'nonsense', 'article'];

export function isSpeakType(value: unknown): value is SpeakType {
  return typeof value === 'string' && SPEAK_TYPES.includes(value);
}

/** 类型中文标签（agent 派生标题兜底、CP 归一化旧记录补齐共用） */
export const SPEAK_TYPE_LABELS: Record<SpeakType, string> = {
  share: '分享',
  nonsense: '碎碎念',
  article: '文章',
};

/** 推送历史记录（agent 写入的 speaks JSONL 一行） */
export interface SpeakRecord {
  /** 内容自身的稳定 ID，与投递渠道无关；旧历史可缺省。 */
  contentId?: string;
  content: string;
  type: SpeakType;
  pushed: boolean;
  timestamp: string;
  /** 渠道消息 ID（点赞/踩按它归因；短命 worker 退出后靠它反查） */
  messageId?: string;
  /** 各渠道返回的消息 ID，兼容从飞书/Telegram 发起的反馈。 */
  channelMessageIds?: { feishu?: string; telegram?: string };
  /** 卡片标题；新文章由 ReAct 独立撰写，旧记录可待 agent 补全 */
  title: string;
  /** 新标题来源：ReAct 或经审阅的历史补全；旧记录缺省。 */
  titleSource?: 'react' | 'backfill';
  /** 已通过质检、属于同租户的表情包图鉴 ID。 */
  memeId?: string;
  /** false = 只展示于历史/墙；通知网关不得后续补发。缺省保持旧通知语义。 */
  notify?: boolean;
  /** 内容中的第一个链接，无则省略 */
  url?: string;
  /** 卡片摘要，从 content 派生 */
  summary: string;
  /** 推送当时的心情 */
  mood?: PetMood;
  /** 被推送门控拦截（true = 只学习没推送） */
  gated?: boolean;
  /** 被套餐日预算/时间窗拦下（与 gated 同为仅记录，但原因可区分） */
  planLimited?: boolean;
  /** 门控评分 */
  gateScore?: number;
  /** 推送理由（门控各因子得分，人类可读） */
  gateReasons?: string[];
  /** 门控命中的兴趣话题（反馈归因持久化） */
  matchedTopics?: string[];
  /**
   * 命中的口头禅文本（按内容包含扫描落盘，反馈时按 messageId 反查归因）。
   * 存文本而非 id：LLM 自由发挥无法结构化标记；副作用是改文案后旧记录
   * 归因静默跳过（不误归因、不报错）。
   */
  matchedCatchphrases?: string[];
}

/** /api/history 展示视图：CP 归一化后（content→message；旧记录补齐 title/summary） */
export interface SpeakHistoryItem {
  contentId?: string;
  /** 推送正文原文 */
  message: string;
  timestamp: string;
  title: string;
  /** CP 从 memeId 投影的鉴权图片路径；缺省则无配图。 */
  memeImageUrl?: string;
  summary: string;
  url?: string;
  mood?: PetMood;
  type?: SpeakType;
  /** 是否真的推送出去了 */
  pushed?: boolean;
  /** 是否被推送门控拦截（仅学习，没告诉主人） */
  gated?: boolean;
  gateReasons?: string[];
  messageId?: string;
  matchedTopics?: string[];
}

/** 反馈归因统一投影：内容 ID 为主键，同时保留旧消息及飞书/Telegram 别名。 */
export function getSpeakFeedbackIdentity(raw: Record<string, unknown>): {
  contentId?: string;
  messageId?: string;
  aliases: string[];
} {
  const id = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  const contentId = id(raw.contentId);
  const legacyId = id(raw.messageId);
  const channels = raw.channelMessageIds;
  const channelIds = typeof channels === 'object' && channels !== null
    ? [id(Reflect.get(channels, 'feishu')), id(Reflect.get(channels, 'telegram'))]
    : [];
  const aliases = [contentId, legacyId, ...channelIds].filter((value): value is string => value !== undefined);
  return { contentId, messageId: contentId ?? legacyId, aliases: [...new Set(aliases)] };
}

/** 展示原文链接的语法校验；不承担服务端网络请求的 DNS/SSRF 隔离。 */
export function getSpeakSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
