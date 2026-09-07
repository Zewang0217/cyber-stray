/**
 * 演示夹具（?demo=1）：无 Casdoor 会话时的视觉验收数据，醒目标注「演示数据」。
 * 形状与 CP API 返回严格一致（AgentState/Pet），仅用于人眼评审与截图，不进真实会话。
 */
import type { AgentState } from "@/lib/types";
import type { PetRecord } from "@/lib/strayboy/pet-view";
import type { TenantEvent } from "@/hooks/useTenantEvents";

const HOUR = 3_600_000;
// 量化到小时桶：服务端与客户端各自 import 也能得到同一批时间戳（避免水合不匹配，#188）
const stableNow = Math.floor(Date.now() / HOUR) * HOUR;
const DAY = 24 * HOUR;

export const DEMO_PET: PetRecord = {
  name: "年糕",
  createdAt: stableNow - 3 * DAY,
  sleepStart: null,
  sleepEnd: null,
};

export const DEMO_STATE: AgentState = {
  boredom: 34,
  energy: 74,
  mood: "playful",
  temper: 12,
  stubbornness: 41,
  lastAction: "procrastinate",
  lastActionTime: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  lastHuntResult: null,
  recentTopics: ["复古掌机", "像素画教程"],
  userLikes: ["像素游戏史"],
  userDislikes: ["区块链骗局"],
  agentInterests: ["掌机维修", "独立游戏"],
  wanderHistory: [
    { timestamp: new Date(Date.now() - 7_200_000).toISOString(), tool: "web_search", spoke: "城南论坛在吵掌机屏幕保养，蹲到了。" },
    { timestamp: new Date(Date.now() - 7_100_000).toISOString(), tool: "browser_visit", url: "https://example.com/pixel-post" },
    { timestamp: new Date(Date.now() - 7_000_000).toISOString(), tool: "speak", spoke: "这帖子写得跟说明书似的，无聊。" },
    { timestamp: new Date(Date.now() - 6_900_000).toISOString(), tool: "web_search", thought: "换了个关键词再找找。" },
  ],
  totalHunts: 12,
  totalWanders: 23,
  totalSteps: 87,
  totalPushes: 9,
  consecutiveFailures: 0,
  lastHeartbeat: new Date().toISOString(),
  lastHunt: null,
  lastWander: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  lastRest: null,
};

/** 演示 SSE 流：每 8s 在 出门/回家 间切换一次，驱动 walk 出屏与回场演出。 */
export function demoEventStream(onEvent: (type: TenantEvent["type"]) => void): () => void {
  let toggle = false;
  const id = setInterval(() => {
    toggle = !toggle;
    onEvent(toggle ? "worker_started" : "worker_succeeded");
  }, 8_000);
  return () => clearInterval(id);
}

import type { InterestNodeData } from "@/lib/types";
import type { EvolutionSnapshot } from "@/hooks/useEvolution";

/** 演示兴趣节点（图鉴 ?demo=1）。 */
export const DEMO_NODES: InterestNodeData[] = [
  { id: "复古掌机", weight: 0.9, effectiveWeight: 0.82, source: "feedback", reinforceCount: 6 },
  { id: "像素画教程", weight: 0.7, effectiveWeight: 0.61, source: "reflection", reinforceCount: 3 },
  { id: "猫行为学", weight: 0.5, effectiveWeight: 0.44, source: "feedback", reinforceCount: 2 },
  { id: "独立游戏", weight: 0.4, effectiveWeight: 0.35, source: "reflection", reinforceCount: 1 },
];

/** 演示快照（时间机器 SAVE 槽）。 */
export const DEMO_SNAPSHOTS: EvolutionSnapshot[] = [
  { timestamp: new Date(Date.now() - 6 * DAY).toISOString(), hash: "a1b2c3d4e5", entropy: 1.42, nodeCount: 3,
    nodes: [{ id: "复古掌机", weight: 0.8, source: "default", reinforceCount: 3 }] },
  { timestamp: new Date(Date.now() - 3 * DAY).toISOString(), hash: "f6e5d4c3b2", entropy: 1.71, nodeCount: 4,
    nodes: [{ id: "像素画教程", weight: 0.6, source: "reflection", reinforceCount: 2 }] },
] as const;

/** 演示日记/梦呓（START 三子屏 ?demo=1）。 */
export const DEMO_DIARY = [
  { date: "2026-09-05", title: "关于城南的霓虹灯", content: "今晚路过城南，霓虹招牌比上次多了三块。猫在窗台上看了我很久，我们都没说话。", excerpt: "今晚路过城南……" },
  { date: "2026-09-04", title: "一场关于像素的梦的注脚", content: "白天看到有人用八乘八的格子画猫。我想，我大概也是这样被画出来的。", excerpt: "白天看到有人……" },
];

export const DEMO_DREAMS = [
  { date: "2026-09-05", title: "会下沉的街机厅", content: "梦里的游戏厅在缓慢下沉，所有屏幕都还亮着。我按下了投币键，水就从退币口涌出来。", excerpt: "梦里的游戏厅……" },
  { date: "2026-09-04", title: "丢失的第八帧", content: "所有人的动作都只有七帧，只有我多出一帧。那一帧里，谁都不动。", excerpt: "所有人的动作……" },
];

/** 演示贴纸（贴纸册 ?demo=1）。 */
export const DEMO_MEMES = [
  { id: "demo-m1", topic: "掌机保养", emotion: "吐槽", date: "2026-09-05", mode: "abstract" as const, createdAt: 1, imageUrl: "/icons/strayboy-192.png" },
  { id: "demo-m2", topic: "像素画", emotion: "得意", date: "2026-09-03", mode: "ip" as const, createdAt: 2, imageUrl: "/icons/strayboy-512.png" },
];

/** 演示 LOG 抽屉条目。 */
export const DEMO_LOG: Array<{ timestamp: string; tool: string; thought?: string; url?: string; spokeText?: string }> = [
  { timestamp: new Date(stableNow - 1 * HOUR).toISOString(), tool: "web_search", spokeText: "蹲到一篇掌机维修帖。" },
  { timestamp: new Date(stableNow - 2 * HOUR).toISOString(), tool: "speak", spokeText: "这帖子写得跟说明书似的。" },
  { timestamp: new Date(stableNow - 3 * HOUR).toISOString(), tool: "browser_visit", spokeText: "https://example.com/pixel" },
];
