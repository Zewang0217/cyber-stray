import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import type { PushContent, ApiResponse, SpeakType, Mood } from "@/lib/types";
import { dataPath } from "@/lib/data-path";

/** agent 写入的一行原始记录（新旧格式的并集） */
interface RawSpeakRecord {
  content?: string;
  type?: SpeakType;
  pushed?: boolean;
  timestamp?: string;
  title?: string;
  url?: string;
  summary?: string;
  mood?: Mood;
  gated?: boolean;
}

const TITLE_MAX_CHARS = 40;
const SUMMARY_MAX_CHARS = 120;

const TYPE_LABELS: Record<SpeakType, string> = {
  share: "分享",
  nonsense: "碎碎念",
  article: "文章",
};

function stripDecoration(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars ? text : `${chars.slice(0, maxChars).join("")}…`;
}

/**
 * 归一化一条历史记录
 *
 * 2026-07 之前的记录只有正文，没有 title/summary。这里用通用截断补齐，让旧数据
 * 也能上卡片；新记录直接透传。url 与 mood 不在此派生——URL 提取规则由 agent 侧
 * url-tracker 独占，mood 是 agent 的内部状态，两者都不该由渲染侧猜。
 */
function normalizeRecord(raw: RawSpeakRecord): PushContent | null {
  const message = raw.content ?? "";
  const timestamp = raw.timestamp;

  if (!timestamp) {
    return null;
  }

  const fallbackTitle = raw.type ? TYPE_LABELS[raw.type] : "推送";
  const stripped = stripDecoration(message);

  return {
    message,
    timestamp,
    title: raw.title ?? (stripped ? truncate(stripped, TITLE_MAX_CHARS) : fallbackTitle),
    summary: raw.summary ?? truncate(stripped, SUMMARY_MAX_CHARS),
    ...(raw.url ? { url: raw.url } : {}),
    ...(raw.mood ? { mood: raw.mood } : {}),
    ...(raw.type ? { type: raw.type } : {}),
    ...(raw.pushed !== undefined ? { pushed: raw.pushed } : {}),
    ...(raw.gated ? { gated: true } : {}),
  };
}

/**
 * 解析 JSONL 历史文件内容（每行一条推送记录）
 * 单行损坏只跳过该行，不影响其余记录
 */
function parseHistoryJsonl(content: string): PushContent[] {
  const records: PushContent[] = [];
  for (const line of content.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const normalized = normalizeRecord(JSON.parse(trimmed) as RawSpeakRecord);
      if (normalized) {
        records.push(normalized);
      }
    } catch {
      // 跳过损坏的单行
    }
  }
  return records;
}

/**
 * GET /api/history
 * 读取历史推送记录
 */
export async function GET(): Promise<NextResponse<ApiResponse<PushContent[]>>> {
  try {
    const historyDir = dataPath("history");
    const files = await readdir(historyDir);
    // Agent 写入 speaks-*.jsonl（每行一条推送记录）；仅扫描 .jsonl，
    // 避免误读同目录下的非历史文件（如 pushed.json 去重状态）
    const historyFiles = files.filter((f) => f.endsWith(".jsonl"));

    const items: PushContent[] = [];
    for (const file of historyFiles.slice(-50)) {
      try {
        const content = await readFile(dataPath("history", file), "utf-8");
        // 历史文件为 JSONL 格式（每行一条推送记录），逐行解析
        items.push(...parseHistoryJsonl(content));
      } catch {
        // 跳过无法读取的文件
      }
    }

    // 按时间倒序
    items.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({
      success: true,
      data: items,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取历史记录失败";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
