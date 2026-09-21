/**
 * 推送历史的展示层归一化（领域层，纯函数）
 *
 * Web 展示规则：旧记录缺 title/summary 时截断补齐、类型中文标签、
 * URL/装饰符清洗。写入侧规则只在 agent（web 只读契约：解析在 agent、
 * 展示归一化在 CP，两侧各管一半）。
 */

const TITLE_MAX_CHARS = 40;
const SUMMARY_MAX_CHARS = 120;

const TYPE_LABELS: Record<string, string> = {
  share: '分享',
  nonsense: '碎碎念',
  article: '文章',
};

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
export function normalizeRecord(raw: Record<string, unknown>): Record<string, unknown> | null {
  const timestamp = raw.timestamp;
  if (typeof timestamp !== 'string') return null;

  const message = typeof raw.content === 'string' ? raw.content : '';
  const type = typeof raw.type === 'string' ? raw.type : undefined;
  const stripped = stripDecoration(message);
  const fallbackTitle = type ? (TYPE_LABELS[type] ?? '推送') : '推送';

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
    ...(typeof raw.mood === 'string' ? { mood: raw.mood } : {}),
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
export function parseHistoryJsonl(content: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
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
