import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import type { ApiResponse, InterestSnapshot } from "@/lib/types";

/**
 * GET /api/interests/history
 * 读取兴趣图谱权重时间序列
 * 支持 ?limit=30 参数（默认 30）
 */
export async function GET(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<InterestSnapshot[]>>> {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "30", 10) || 30, 1),
      100,
    );

    let snapshots: InterestSnapshot[] = [];

    try {
      const content = await readFile("../data/interest-history.jsonl", "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (
            typeof parsed.timestamp === "string" &&
            Array.isArray(parsed.nodes) &&
            typeof parsed.entropy === "number"
          ) {
            snapshots.push(parsed as InterestSnapshot);
          }
        } catch {
          // 跳过非法行
        }
      }
    } catch {
      // 文件不存在 → 返回空数组
      snapshots = [];
    }

    // 返回最近 N 条
    const recent = snapshots.slice(-limit);

    return NextResponse.json({
      success: true,
      data: recent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取兴趣历史失败";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
