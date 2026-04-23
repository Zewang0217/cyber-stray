import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import type { PushContent, ApiResponse } from "@/lib/types";

/**
 * GET /api/history
 * 读取历史推送记录
 */
export async function GET(): Promise<NextResponse<ApiResponse<PushContent[]>>> {
  try {
    const files = await readdir("../data/history");
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const items: PushContent[] = [];
    for (const file of jsonFiles.slice(-50)) {
      try {
        const content = await readFile(`../data/history/${file}`, "utf-8");
        const parsed = JSON.parse(content) as PushContent | PushContent[];
        if (Array.isArray(parsed)) {
          items.push(...parsed);
        } else {
          items.push(parsed);
        }
      } catch {
        // 跳过损坏的文件
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
