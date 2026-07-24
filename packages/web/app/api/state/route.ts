import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import type { AgentState, ApiResponse } from "@/lib/types";

/**
 * GET /api/state
 * 读取 Agent 当前状态
 */
export async function GET(): Promise<NextResponse<ApiResponse<AgentState>>> {
  try {
    const content = await readFile("../data/state.json", "utf-8");
    const state = JSON.parse(content) as AgentState;

    return NextResponse.json({
      success: true,
      data: state,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取状态失败";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
