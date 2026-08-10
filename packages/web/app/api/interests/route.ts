import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import type { ApiResponse, InterestGraphResponse } from "@/lib/types";
import { dataPath } from "@/lib/data-path";

/**
 * GET /api/interests
 * 读取兴趣图谱当前状态（含熵值）。
 *
 * 熵值公式与 packages/agent/src/memory/interest-graph.ts 的
 * InterestGraph.getEntropy() 同步保持。
 * 注意：API 用 raw weight，Graph 内部用 effectiveWeight（含时间衰减）。
 * 两端差异可接受——API 展示原始分布，Graph 用于衰减后决策。
 */
export async function GET(): Promise<NextResponse<ApiResponse<InterestGraphResponse>>> {
  try {
    let nodes = [];
    let lastUpdated: string | null = null;

    try {
      const content = await readFile(dataPath("interests.json"), "utf-8");
      const data = JSON.parse(content);
      nodes = data.nodes ?? [];
      lastUpdated = data.lastUpdated ?? null;
    } catch {
      // 文件不存在 → 返回空数据
      nodes = [];
    }

    // 计算 Shannon 熵（与 InterestGraph.getEntropy() 同公式）
    const weights: number[] = nodes
      .map((n: { weight: number }) => n.weight)
      .filter((w: number) => w > 0);

    let entropy = 0;
    if (weights.length > 0) {
      const total = weights.reduce((sum: number, w: number) => sum + w, 0);
      if (total > 0) {
        for (const w of weights) {
          const p = w / total;
          if (p > 0) {
            entropy -= p * Math.log2(p);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        nodes,
        entropy: Math.round(entropy * 1000) / 1000,
        nodeCount: nodes.length,
        lastUpdated,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取兴趣图谱失败";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
