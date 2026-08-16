/**
 * 推送历史记录的结构化派生
 *
 * speak 工具只从 LLM 拿到一段自由文本 content，而 Web 仪表盘的卡片需要
 * 标题 / 链接 / 摘要来渲染。这里把 content 拆成结构化字段，避免为此扩大
 * 工具入参 schema（多加字段会让 LLM 每次 speak 都要多想两件事）。
 */

import type { Mood } from '../../types.js';
import { extractUrl } from '../dedup/url-tracker.js';
// 仅类型导入，编译期擦除，与 speak.ts 的反向值依赖不构成运行时循环
import type { SpeakType } from './speak.js';

/** 标题最大字符数（按字符而非字节，中文场景下与显示宽度一致） */
const TITLE_MAX_CHARS = 40;

/** 摘要最大字符数 */
const SUMMARY_MAX_CHARS = 120;

/** 无法从内容提取标题时的兜底名称 */
const TYPE_LABELS: Record<SpeakType, string> = {
  share: '分享',
  nonsense: '碎碎念',
  article: '文章',
};

/** 推送历史记录条目 */
export interface SpeakRecord {
  content: string;
  type: SpeakType;
  pushed: boolean;
  timestamp: string;
  messageId?: string;
  /** 卡片标题，从 content 派生 */
  title: string;
  /** 内容中的第一个链接，无则省略 */
  url?: string;
  /** 卡片摘要，从 content 派生 */
  summary: string;
  /** 推送当时的心情 */
  mood?: Mood;
  /** 是否被推送门控拦截（true 表示只学习没推送） */
  gated?: boolean;
  /** 是否被套餐日预算/时间窗拦下（S11：内容落盘但未推——与 gated 同为
   * "仅记录"，但原因可区分，供仪表盘解释与 push-gateway 跳过） */
  planLimited?: boolean;
  /** 门控评分 */
  gateScore?: number;
  /** 推送理由（门控各因子得分，人类可读；S8 推送流展示） */
  gateReasons?: string[];
  /** 门控命中的兴趣话题（S9 反馈归因持久化——worker 短命进程退出后
   * 内存 map 即失效，REST 反馈从 speaks 历史按 messageId 反查） */
  matchedTopics?: string[];
}

/** 构建记录时的附加信息 */
export interface SpeakRecordMeta {
  mood?: Mood;
  messageId?: string;
  gated?: boolean;
  planLimited?: boolean;
  gateScore?: number;
  /** 推送理由（quality hook 评估产出，随记录持久化） */
  gateReasons?: string[];
  /** 门控命中话题（quality hook 产出；落盘供反馈归因） */
  matchedTopics?: string[];
}

/** 去掉 URL、markdown 标记与多余空白 */
function stripDecoration(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars ? text : `${chars.slice(0, maxChars).join('')}…`;
}

/**
 * 从推送内容派生卡片标题
 *
 * 取第一行有实质内容的文本；整段都是链接或空白时回退到类型名。
 */
export function deriveTitle(content: string, type: SpeakType): string {
  for (const line of content.split('\n')) {
    const cleaned = stripDecoration(line);
    if (cleaned) {
      return truncate(cleaned, TITLE_MAX_CHARS);
    }
  }
  return TYPE_LABELS[type];
}

/**
 * 从推送内容派生卡片摘要
 */
export function deriveSummary(content: string): string {
  return truncate(stripDecoration(content), SUMMARY_MAX_CHARS);
}

/**
 * 组装一条推送历史记录
 */
export function buildSpeakRecord(
  content: string,
  type: SpeakType,
  pushed: boolean,
  timestamp: string,
  meta: SpeakRecordMeta = {},
): SpeakRecord {
  const url = extractUrl(content);

  return {
    content,
    type,
    pushed,
    timestamp,
    title: deriveTitle(content, type),
    summary: deriveSummary(content),
    ...(url ? { url } : {}),
    ...(meta.messageId ? { messageId: meta.messageId } : {}),
    ...(meta.mood ? { mood: meta.mood } : {}),
    ...(meta.gated ? { gated: true } : {}),
    ...(meta.planLimited ? { planLimited: true } : {}),
    ...(meta.gateScore !== undefined ? { gateScore: meta.gateScore } : {}),
    ...(meta.gateReasons?.length ? { gateReasons: meta.gateReasons } : {}),
    ...(meta.matchedTopics?.length ? { matchedTopics: meta.matchedTopics } : {}),
  };
}
