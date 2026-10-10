/**
 * 演示夹具（?demo=1）：无 Casdoor 会话时的视觉验收数据，醒目标注「演示数据」。
 * 形状与 CP API 返回严格一致（AgentStateSnapshot/Pet），仅用于人眼评审与截图。
 */
import type { AgentStateSnapshot } from "@cyber-stray/shared/agent-state";
import type { InterestNode } from "@cyber-stray/shared/interest-graph";
import type { TenantEvent } from "@/hooks/useTenantEvents";
import type { EvolutionSnapshot } from "@/hooks/useEvolution";
import type { PetRecord } from "@/lib/strayboy/pet-view";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 固定基准时刻 + 小时桶量化：模块级 Date.now() 会让 SSR 与客户端渲染出
// 不同的日期标签（跨分钟/日边界时）→ hydration 告警。demo 只做视觉验收，
// 固定时刻即可；服务端与客户端各自 import 也得到同一批时间戳。
const DEMO_EPOCH = new Date("2026-09-01T10:00:00+08:00").getTime();
const stableNow = Math.floor(DEMO_EPOCH / HOUR) * HOUR;

export const DEMO_PET: PetRecord = {
  name: "年糕",
  createdAt: stableNow - 3 * DAY,
  sleepStart: null,
  sleepEnd: null,
};

export const DEMO_STATE: AgentStateSnapshot = {
  boredom: 34,
  energy: 74,
  mood: "playful",
  temper: 12,
  stubbornness: 41,
  lastActionTime: new Date(DEMO_EPOCH - 2 * HOUR).toISOString(),
  recentTopics: ["复古掌机", "像素画教程"],
  userLikes: ["像素游戏史"],
  userDislikes: ["区块链骗局"],
  agentInterests: ["掌机维修", "独立游戏"],
  wanderHistory: [
    { timestamp: new Date(DEMO_EPOCH - 2 * HOUR).toISOString(), tool: "web_search", spoke: "城南论坛在吵掌机屏幕保养，蹲到了。" },
    { timestamp: new Date(DEMO_EPOCH - 119 * 60_000).toISOString(), tool: "browser_visit", url: "https://example.com/pixel-post" },
    { timestamp: new Date(DEMO_EPOCH - 118 * 60_000).toISOString(), tool: "speak", spoke: "这帖子写得跟说明书似的，无聊。" },
    { timestamp: new Date(DEMO_EPOCH - 117 * 60_000).toISOString(), tool: "web_search", thought: "换了个关键词再找找。" },
  ],
  totalWanders: 23,
  totalSteps: 87,
  totalPushes: 9,
  consecutiveFailures: 0,
  lastHeartbeat: new Date(DEMO_EPOCH).toISOString(),
  lastWander: new Date(DEMO_EPOCH - 2 * HOUR).toISOString(),
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

/** 演示兴趣节点（图鉴 ?demo=1）。 */
export const DEMO_NODES: InterestNode[] = [
  { id: "复古掌机", weight: 0.9, source: "feedback", reinforceCount: 6, createdAt: new Date(DEMO_EPOCH - 2 * DAY).toISOString(), lastReinforced: new Date(DEMO_EPOCH - HOUR).toISOString() },
  { id: "像素画教程", weight: 0.7, source: "reflection", reinforceCount: 3, createdAt: new Date(DEMO_EPOCH - 2 * DAY).toISOString(), lastReinforced: new Date(DEMO_EPOCH - 5 * HOUR).toISOString() },
  { id: "猫行为学", weight: 0.5, source: "feedback", reinforceCount: 2, createdAt: new Date(DEMO_EPOCH - DAY).toISOString(), lastReinforced: new Date(DEMO_EPOCH - 8 * HOUR).toISOString() },
  { id: "独立游戏", weight: 0.4, source: "reflection", reinforceCount: 1, createdAt: new Date(DEMO_EPOCH - DAY).toISOString(), lastReinforced: new Date(DEMO_EPOCH - 20 * HOUR).toISOString() },
];

/** 演示快照（时间机器 SAVE 槽）。 */
export const DEMO_SNAPSHOTS: EvolutionSnapshot[] = [
  { timestamp: new Date(DEMO_EPOCH - 6 * DAY).toISOString(), hash: "a1b2c3d4e5", entropy: 1.42, nodeCount: 3,
    nodes: [{ id: "复古掌机", weight: 0.8, source: "default", reinforceCount: 3 }] },
  { timestamp: new Date(DEMO_EPOCH - 3 * DAY).toISOString(), hash: "f6e5d4c3b2", entropy: 1.71, nodeCount: 4,
    nodes: [{ id: "像素画教程", weight: 0.6, source: "reflection", reinforceCount: 2 }] },
] as const;

/** 演示日记/梦呓（START 三子屏 ?demo=1）。日记正文与真实契约一致用 markdown。 */
export const DEMO_DIARY = [
  {
    date: "2026-09-05",
    title: "关于城南的霓虹灯",
    content: "# 关于城南的霓虹灯\n\n今晚路过城南，霓虹招牌比上次**多了三块**：\n\n- 面馆的灯箱换成了双色的\n- 当铺挂出一块只亮一半的\n- 巷口新开的小卖部，整面墙都在闪\n\n猫在窗台上看了我很久，我们都没说话。",
    excerpt: "今晚路过城南……",
  },
  {
    date: "2026-09-04",
    title: "一场关于像素的梦的注脚",
    content: "# 一场关于像素的梦的注脚\n\n白天看到有人用八乘八的格子画猫。我想，我大概也是这样被画出来的。",
    excerpt: "白天看到有人……",
  },
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

/** 演示足迹（/trail ?demo=1）：两次游荡，含失败、拦截叼回、跨巷跳跃。 */
export const DEMO_TRAIL_STEPS = [
  { timestamp: new Date(stableNow - 50 * 60_000).toISOString(), tool: "search_web", alley: "复古掌机巷", title: "GBA 屏幕老化 修复", thought: "搜索(premium): GBA 屏幕老化 修复" },
  { timestamp: new Date(stableNow - 49 * 60_000).toISOString(), tool: "read_page", alley: "复古掌机巷", title: "IPS 改装屏全指南", url: "https://example.com/gba-ips", thought: "读取: IPS 改装屏全指南" },
  { timestamp: new Date(stableNow - 48 * 60_000).toISOString(), tool: "read_page", alley: "复古掌机巷", url: "https://example.com/dead-link", status: "failed", thought: "读取失败: 403 Forbidden" },
  { timestamp: new Date(stableNow - 47 * 60_000).toISOString(), tool: "record_knowledge", alley: "复古掌机巷", title: "GBA 原装屏排线 40pin", url: "https://example.com/gba-ips", thought: "记住了: GBA 原装屏排线 40pin" },
  { timestamp: new Date(stableNow - 46 * 60_000).toISOString(), tool: "speak", alley: "复古掌机巷", title: "掌机换屏大发现", spoke: "喵！原来 GBA 换 IPS 屏不用焊主板了，排线直插——老掌机玩家的春天。https://example.com/gba-ips", thought: "[share] 表达了想法" },
  { timestamp: new Date(stableNow - 45 * 60_000).toISOString(), tool: "speak", alley: "复古掌机巷", title: "被拦下的安利", status: "blocked", spoke: "再安利一家改装店……", thought: "[share] 内容被护栏拦截 (URL 冷却期)" },
  { timestamp: new Date(stableNow - 44 * 60_000).toISOString(), tool: "rest", thought: "主动结束游荡" },
  { timestamp: new Date(stableNow - 20 * 60_000).toISOString(), tool: "search_web", alley: "像素画弄堂", title: "pixel art dithering tutorial", thought: "搜索(free): pixel art dithering tutorial" },
  { timestamp: new Date(stableNow - 19 * 60_000).toISOString(), tool: "read_page", alley: "像素画弄堂", title: "抖动上色入门", url: "https://example.com/dithering", thought: "读取: 抖动上色入门" },
  { timestamp: new Date(stableNow - 18 * 60_000).toISOString(), tool: "record_knowledge", alley: "像素画弄堂", title: "Bayer 抖动矩阵", url: "https://example.com/dithering", thought: "记住了: Bayer 抖动矩阵" },
  { timestamp: new Date(stableNow - 17 * 60_000).toISOString(), tool: "speak", alley: "像素画弄堂", title: "抖动的浪漫", spoke: "原来 8bit 时代的渐变是骗眼睛的——Bayer 矩阵把两种颜色撒成胡椒面，远看就是过渡色。https://example.com/dithering", thought: "[share] 表达了想法" },
  { timestamp: new Date(stableNow - 16 * 60_000).toISOString(), tool: "rest", thought: "主动结束游荡" },
];

/** 演示记忆索引记录（/trail ?demo=1 图谱）。 */
export const DEMO_TRAIL_MEMORY = [
  { id: "demo-k1", type: "knowledge", timestamp: new Date(stableNow - 47 * 60_000).toISOString(), tags: ["knowledge", "复古掌机"], summary: "GBA 原装屏排线 40pin", url: "https://example.com/gba-ips" },
  { id: "demo-k2", type: "knowledge", timestamp: new Date(stableNow - 18 * 60_000).toISOString(), tags: ["knowledge", "像素画"], summary: "Bayer 抖动矩阵", url: "https://example.com/dithering" },
  { id: "demo-k3", type: "knowledge", timestamp: new Date(stableNow - 3 * DAY).toISOString(), tags: ["knowledge", "复古掌机"], summary: "城南论坛的维修帖汇总（旧记忆，无链接）" },
];

/** 演示叼回记录（/trail ?demo=1 图谱）。 */
export const DEMO_TRAIL_SPEAKS = [
  { timestamp: new Date(stableNow - 46 * 60_000).toISOString(), title: "掌机换屏大发现", url: "https://example.com/gba-ips", matchedTopics: ["复古掌机"] },
  { timestamp: new Date(stableNow - 45 * 60_000).toISOString(), title: "被拦下的安利", gated: true, matchedTopics: ["复古掌机"] },
  { timestamp: new Date(stableNow - 17 * 60_000).toISOString(), title: "抖动的浪漫", url: "https://example.com/dithering", matchedTopics: ["像素画"] },
];
