/**
 * 街角视图状态机单测：SSE/CP 数据 → 演出参数（表驱动，只断言外部行为）。
 */
import { describe, expect, it } from "vitest";
import { deriveStreetView, HUNGRY_ENERGY_THRESHOLD } from "./pet-view";
import type { AgentState } from "@/lib/types";

const PET = { name: "年糕", createdAt: Date.now() - 3 * 86_400_000, sleepStart: null, sleepEnd: null };

function state(over: Partial<AgentState>): AgentState {
  return {
    boredom: 30, energy: 80, mood: "playful", temper: 10, stubbornness: 20,
    lastAction: null, lastActionTime: null, lastHuntResult: null, recentTopics: [],
    userLikes: [], userDislikes: [], agentInterests: [], wanderHistory: [],
    totalHunts: 0, totalWanders: 23, totalSteps: 0, totalPushes: 0,
    consecutiveFailures: 0, ...over,
  } as AgentState;
}

describe("deriveStreetView", () => {
  it("HUD 三墨条 = 后端原始值零换算；心情 = 枚举原文；LV/DAY 不变", () => {
    const v = deriveStreetView(state({ energy: 80, boredom: 30, temper: 10, totalWanders: 23 }), PET, new Date(), false);
    expect(v.bars).toEqual({ energy: 80, boredom: 30, temper: 10 });
    expect(v.mood).toBe("playful");
    expect(v.level).toBe(2);
    expect(v.day).toBe(4);
    expect(v.anim).toBe("idle");
    expect(v.away).toBe(false);
  });

  it("#217 未知态：state=null → 三墨条 null + 心情 null，禁伪装健康兜底", () => {
    const v = deriveStreetView(null, PET, new Date(), false);
    expect(v.bars).toEqual({ energy: null, boredom: null, temper: null });
    expect(v.mood).toBeNull();
    expect(v.hungry).toBe(false); // null 不冒充饥饿
    expect(v.level).toBe(0);
  });

  it("游荡进行中 → 出屏 walk；连续失败 ≥3 → grumpy", () => {
    expect(deriveStreetView(state({}), PET, new Date(), true).away).toBe(true);
    expect(deriveStreetView(state({}), PET, new Date(), true).anim).toBe("walk");
    expect(deriveStreetView(state({ consecutiveFailures: 3 }), PET, new Date(), false).anim).toBe("grumpy");
  });

  it("精力低于阈值 → 饿演出；睡眠窗口 → sleep", () => {
    expect(deriveStreetView(state({ energy: HUNGRY_ENERGY_THRESHOLD - 1 }), PET, new Date(), false).hungry).toBe(true);
    const night = new Date();
    const pet = { ...PET, sleepStart: 0, sleepEnd: 23 };
    const v = deriveStreetView(state({}), pet, new Date(night.getFullYear(), night.getMonth(), night.getDate(), 2), false);
    expect(v.sleeping).toBe(true);
    expect(v.anim).toBe("sleep");
    expect(v.away).toBe(false);
  });
});
