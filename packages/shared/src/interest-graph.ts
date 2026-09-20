/**
 * 兴趣图谱的跨包单一真相源：文件形状类型 + 领养种子默认值。
 *
 * agent（图谱读写方）与 control-plane（领养种子写方）共同消费——形状或
 * 默认值变更只改这里，禁止在任一包内复制（此前 CP 复制 schema 靠注释与
 * agent 同步，已发生过注释漂移）。运行时校验（zod）在 agent 侧，本包保持零依赖。
 */

/** 图谱文件 schema 版本 */
export const INTEREST_GRAPH_VERSION = 2 as const;

/** 领养默认兴趣种子：CP 领养时写入、agent seedDefaults 兜底，改这里即两侧同步 */
export const DEFAULT_INTEREST_SEEDS = ['科技', 'AI', '互联网'] as const;

/** 种子初始权重：从 default 源低权重起步，留出信号加权的成长空间 */
export const INTEREST_SEED_WEIGHT = 0.5;

export type InterestSource = 'default' | 'reflection' | 'feedback' | 'migration';

export interface InterestNode {
  id: string;
  weight: number;
  source: InterestSource;
  createdAt: string;
  lastReinforced: string;
  reinforceCount: number;
  /** 父节点 id（叶子路径的父级）；根节点（一级）缺省 */
  parent?: string;
  /** taxonomy 路径；一级节点 = id 自身，叶子 = `天文/黑洞` */
  path?: string;
  /** 正向示例内容（like/boost 信号消解后的原文，反馈归因与展示引用用） */
  exemplars?: string[];
  /** 负向示例内容（dislike 信号消解后的原文；只落叶子，不碰父级） */
  negativeExemplars?: string[];
}

/** user-interests.json 文件形状 */
export interface InterestGraphData {
  version: 2;
  lastUpdated: string;
  nodes: InterestNode[];
}

/**
 * Shannon 熵（比特）：权重分布的均匀度。单一真相源——agent（坍缩检测，
 * 传时间衰减后的有效权重）与 control-plane（展示，传存储原始权重）共用
 * 同一公式，任何一侧不得复制。
 *
 * 空集或总权重为 0 → 0。
 */
export function shannonEntropy(weights: number[]): number {
  const positive = weights.filter((w) => w > 0);
  const total = positive.reduce((sum, w) => sum + w, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const w of positive) {
    const p = w / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}
