import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import type { PushContent, ApiResponse } from "@/lib/types";

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
      records.push(JSON.parse(trimmed) as PushContent);
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
    const files = await readdir("../data/history");
    // Agent 写入 speaks-*.jsonl（每行一条推送记录）；仅扫描 .jsonl，
    // 避免误读同目录下的非历史文件（如 pushed.json 去重状态）
    const historyFiles = files.filter((f) => f.endsWith(".jsonl"));

    const items: PushContent[] = [];
    for (const file of historyFiles.slice(-50)) {
      try {
        const content = await readFile(`../data/history/${file}`, "utf-8");
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
