/**
 * 推送历史的展示层归一化（领域层，纯函数）。
 *
 * 展示规则：旧记录缺 title/summary 时截断补齐、类型中文标签、URL/装饰符
 * 清洗。写入侧规则只在 agent；归一化后的形状契约在 shared/push
 * （SpeakHistoryItem，web 渲染同源），非法 mood/type 直接丢弃不透传。
 */

import { isPetMood } from '@cyber-stray/shared/pet-stats';
import { isSpeakType, SPEAK_TYPE_LABELS, type SpeakHistoryItem } from '@cyber-stray/shared/push';

const TITLE_MAX_CHARS = 40;
const SUMMARY_MAX_CHARS = 120;

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

/** 归一化一条记录（旧记录无 title/summary 时截断补齐；url/mood 由 agent 侧独占） */
export function normalizeRecord(raw: Record<string, unknown>): SpeakHistoryItem | null {
  const timestamp = raw.timestamp;
  if (typeof timestamp !== 'string') return null;

  const message = typeof raw.content === 'string' ? raw.content : '';
  const type = isSpeakType(raw.type) ? raw.type : undefined;
  const stripped = stripDecoration(message);
  const fallbackTitle = type ? SPEAK_TYPE_LABELS[type] : '推送';

  return {
    message,
    timestamp,
    title:
      typeof raw.title === 'string'
        ? raw.title
        : stripped
          ? truncate(stripped, TITLE_MAX_CHARS)
          : fallbackTitle,
    summary:
      typeof raw.summary === 'string' ? raw.summary : truncate(stripped, SUMMARY_MAX_CHARS),
    ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
    ...(isPetMood(raw.mood) ? { mood: raw.mood } : {}),
    ...(type ? { type } : {}),
    ...(typeof raw.pushed === 'boolean' ? { pushed: raw.pushed } : {}),
    ...(raw.gated ? { gated: true } : {}),
    ...(Array.isArray(raw.gateReasons)
      ? { gateReasons: raw.gateReasons.filter((r): r is string => typeof r === 'string') }
      : {}),
    ...(typeof raw.messageId === 'string' ? { messageId: raw.messageId } : {}),
    ...(Array.isArray(raw.matchedTopics)
      ? { matchedTopics: raw.matchedTopics.filter((t): t is string => typeof t === 'string') }
      : {}),
  };
}

/** 解析 JSONL；单行损坏只跳过该行 */
export function parseHistoryJsonl(content: string): SpeakHistoryItem[] {
  const records: SpeakHistoryItem[] = [];
  for (const line of content.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const normalized = normalizeRecord(JSON.parse(trimmed) as Record<string, unknown>);
      if (normalized) records.push(normalized);
    } catch {
      // 跳过损坏的单行
    }
  }
  return records;
}
