/**
 * 可进化兴趣图谱（InterestGraph）
 *
 * 替换冻住的 `state.agentInterests`，提供带权/来源/时间衰减的兴趣管理。
 * 持久化到 `data/interests.json`（JSON sidecar，同 `.index.json` 模式）。
 *
 * Phase 2 只建骨架：source 预留 'reflection'/'feedback'，但只产生 'default'。
 * 反思写入(REF)和反馈加权(USR)由下游 Phase 3/4 接入。
 *
 * 核心约束：
 * - 原子写 + 并发安全：唯一 tmp 名 + persist 串行
 * - D-09 错误显式化：文件不存在返空（合法），解析/schema 失败抛错（不兜底）
 * - 模块级单例：getInterestGraph() 按 dataPath 复用
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { z } from 'zod';
import { consola } from '../logger.js';
import { getDataPath } from '../config.js';
import { recordInterestSnapshot } from './interest-history.js';

const logger = consola.withTag('InterestGraph');

// schema 漂移守卫
const GRAPH_VERSION = 1 as const;

// ============================================
// Zod Schemas
// ============================================

export const InterestNodeSchema = z.object({
  id: z.string().min(1),
  weight: z.number().min(0).max(1).refine((n) => Number.isFinite(n), {
    message: 'weight must be finite',
  }),
  source: z.enum(['default', 'reflection', 'feedback']),
  createdAt: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
    message: 'createdAt must be a valid date string',
  }),
  lastReinforced: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
    message: 'lastReinforced must be a valid date string',
  }),
  reinforceCount: z.number().int().min(0),
});

export const InterestGraphDataSchema = z.object({
  version: z.literal(1),
  lastUpdated: z.string(),
  nodes: z.array(InterestNodeSchema),
});

// ============================================
// Types
// ============================================

export type InterestSource = 'default' | 'reflection' | 'feedback';

export interface InterestNode {
  id: string;
  weight: number;
  source: InterestSource;
  createdAt: string;
  lastReinforced: string;
  reinforceCount: number;
}

export interface InterestGraphData {
  version: 1;
  lastUpdated: string;
  nodes: InterestNode[];
}

/** 兴趣图谱配置（来自 agent-config.json） */
export interface InterestGraphConfig {
  decayLambda: number;        // 衰减系数（每天）
  maxWeight: number;          // 单兴趣权重上限
  minInterestCount: number;   // 最少兴趣数量
  noveltyBudget: number;      // 探索预算比例（0-1）
  defaultSeeds: string[];       // 默认种子兴趣
  minWeight: number;          //  dormancy 阈值，低于此标记为 dormant
}

export const DEFAULT_INTEREST_CONFIG: InterestGraphConfig = {
  decayLambda: 0.1,
  maxWeight: 0.8,
  minInterestCount: 3,
  noveltyBudget: 0.15,
  defaultSeeds: ['科技', 'AI', '互联网'],
  minWeight: 0.05,
};

// ============================================
// 原子写辅助（复用 memory-index.ts 模式）
// ============================================

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/')) || '.';
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(data, null, 2);
  await writeFile(tmp, payload, 'utf-8');
  await rename(tmp, path);
}

// ============================================
// InterestGraph 类
// ============================================

export class InterestGraph {
  private readonly filePath: string;
  private data: InterestGraphData;
  private config: InterestGraphConfig;
  /** 并发 persist 串行排队 */
  private persistChain: Promise<void> = Promise.resolve();
  /** 是否已初始化（从文件或种子） */
  private initialized = false;

  constructor(filePath: string, config: InterestGraphConfig = DEFAULT_INTEREST_CONFIG) {
    this.filePath = filePath;
    this.config = config;
    this.data = createDefaultGraphData();
  }

  // ----------------------------------------
  // 加载 / 持久化
  // ----------------------------------------

  /**
   * 从文件加载兴趣图谱。
   * 文件不存在时返回空图谱（调用方应随后 seedDefaults）。
   * 解析/schema 失败抛错（D-09 / CLAUDE.md 红线）。
   */
  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      logger.debug('兴趣图谱文件不存在，使用空图谱', { path: this.filePath });
      this.data = createDefaultGraphData();
      this.initialized = false;
      return;
    }

    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch (error) {
      logger.error('读取兴趣图谱文件失败', { path: this.filePath, error });
      throw new Error(`兴趣图谱读取失败: ${this.filePath}`, { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      logger.error('兴趣图谱解析失败（非法 JSON）', { path: this.filePath, error });
      throw new Error(`兴趣图谱解析失败: ${this.filePath}`, { cause: error });
    }

    const result = InterestGraphDataSchema.safeParse(parsed);
    if (!result.success) {
      logger.error('兴趣图谱 schema 校验失败', {
        path: this.filePath,
        issues: result.error.issues,
      });
      throw new Error(`兴趣图谱 schema 校验失败: ${this.filePath}`, {
        cause: result.error,
      });
    }

    this.data = result.data;
    this.initialized = true;
    logger.debug('兴趣图谱已加载', { nodeCount: this.data.nodes.length });
  }

  /**
   * 原子持久化兴趣图谱。
   * 并发调用串行排队，避免竞态覆盖。
   *
   * Phase 6: 持久化后记录兴趣快照到历史（best-effort，失败不阻断）。
   */
  async persist(): Promise<void> {
    this.data.lastUpdated = new Date().toISOString();
    this.persistChain = this.persistChain.then(async () => {
      await atomicWriteJson(this.filePath, this.data);
    });
    await this.persistChain;

    // Phase 6: 记录兴趣快照用于可观测性（best-effort）
    try {
      await this.recordSnapshot();
    } catch (err) {
      logger.warn('记录兴趣快照失败', { err });
    }

    logger.debug('兴趣图谱已持久化', { nodeCount: this.data.nodes.length });
  }

  /**
   * Phase 6: 构建并记录兴趣快照。
   * 内部方法，由 persist() 调用。
   */
  private async recordSnapshot(): Promise<void> {
    const now = Date.now();
    const snapshotNodes = this.data.nodes.map((n) => ({
      id: n.id,
      weight: n.weight,
      effectiveWeight: this.computeEffectiveWeight(n, now),
      source: n.source,
      reinforceCount: n.reinforceCount,
    }));

    await recordInterestSnapshot({
      timestamp: new Date().toISOString(),
      nodes: snapshotNodes,
      entropy: this.getEntropy(),
      nodeCount: this.data.nodes.length,
    });
  }

  // ----------------------------------------
  // 查询
  // ----------------------------------------

  /**
   * 获取已应用衰减的 top N 兴趣。
   * @param n - 返回数量
   * @param minWeight - 最小权重过滤（默认 0，不过滤）
   * @returns 按权重降序的兴趣 ID 列表
   */
  getTopInterests(n: number, minWeight = 0): string[] {
    const now = Date.now();
    const scored = this.data.nodes.map((node) => ({
      id: node.id,
      effectiveWeight: this.computeEffectiveWeight(node, now),
    }));

    return scored
      .filter((s) => s.effectiveWeight >= minWeight)
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
      .slice(0, n)
      .map((s) => s.id);
  }

  /**
   * 获取已应用衰减的 top N 兴趣（含权重详情）。
   */
  getTopInterestsWithWeights(n: number, minWeight = 0): Array<{ id: string; weight: number }> {
    const now = Date.now();
    const scored = this.data.nodes.map((node) => ({
      id: node.id,
      weight: this.computeEffectiveWeight(node, now),
    }));

    return scored
      .filter((s) => s.weight >= minWeight)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n);
  }

  /** 获取所有节点（原始权重，未衰减） */
  getAllNodes(): ReadonlyArray<InterestNode> {
    return this.data.nodes;
  }

  /** 获取单个兴趣节点的原始权重 */
  getNode(id: string): InterestNode | undefined {
    return this.data.nodes.find((n) => n.id === id);
  }

  /** 计算兴趣图谱的 Shannon 熵（用于坍缩检测） */
  getEntropy(): number {
    const now = Date.now();
    const weights = this.data.nodes
      .map((n) => this.computeEffectiveWeight(n, now))
      .filter((w) => w > 0);

    if (weights.length === 0) return 0;

    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total === 0) return 0;

    let entropy = 0;
    for (const w of weights) {
      const p = w / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }

  /** 获取节点数量 */
  getNodeCount(): number {
    return this.data.nodes.length;
  }

  /** 是否已从文件或种子初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ----------------------------------------
  // 修改
  // ----------------------------------------

  /**
   * 强化某兴趣权重。
   * @param id - 兴趣 ID
   * @param delta - 权重增量（0-1）
   * @returns 是否成功（找不到节点时返回 false）
   */
  reinforce(id: string, delta: number): boolean {
    const node = this.data.nodes.find((n) => n.id === id);
    if (!node) {
      logger.warn('强化失败：兴趣节点不存在', { id });
      return false;
    }

    const now = new Date().toISOString();
    const newWeight = Math.min(this.config.maxWeight, node.weight + delta);

    node.weight = newWeight;
    node.lastReinforced = now;
    node.reinforceCount += 1;

    logger.info('兴趣已强化', { id, newWeight, delta });
    return true;
  }

  /**
   * 添加新兴趣。
   * 检查 novelty 预算：当前总权重 + 新权重 ≤ 1.0 + noveltyBudget。
   * @param id - 兴趣主题
   * @param initialWeight - 初始权重
   * @param source - 来源（Phase 2 用 'default'）
   * @returns 是否成功（已存在或超预算时返回 false）
   */
  addInterest(id: string, initialWeight: number, source: InterestSource = 'default'): boolean {
    // 已存在则不允许重复添加
    if (this.data.nodes.some((n) => n.id === id)) {
      logger.debug('添加兴趣失败：已存在', { id });
      return false;
    }

    // Novelty 预算检查：使用有效权重（衰减后）
    const now = Date.now();
    const totalEffectiveWeight = this.data.nodes.reduce(
      (sum, n) => sum + this.computeEffectiveWeight(n, now),
      0,
    );
    if (totalEffectiveWeight + initialWeight > 1.0 + this.config.noveltyBudget) {
      logger.warn('添加兴趣失败：超出 novelty 预算', {
        id,
        totalEffectiveWeight,
        initialWeight,
        budget: this.config.noveltyBudget,
      });
      return false;
    }

    const nowIso = new Date().toISOString();
    this.data.nodes.push({
      id,
      weight: initialWeight,
      source,
      createdAt: nowIso,
      lastReinforced: nowIso,
      reinforceCount: 0,
    });

    logger.info('新兴趣已添加', { id, weight: initialWeight, source });
    return true;
  }

  /**
   * 从默认种子初始化兴趣图谱。
   * 仅在图谱为空且未初始化时执行。
   */
  seedDefaults(): void {
    if (this.initialized || this.data.nodes.length > 0) {
      return;
    }

    const now = new Date().toISOString();
    const seedWeight = 0.5; // 默认种子初始权重

    for (const seed of this.config.defaultSeeds) {
      this.data.nodes.push({
        id: seed,
        weight: seedWeight,
        source: 'default',
        createdAt: now,
        lastReinforced: now,
        reinforceCount: 0,
      });
    }

    this.initialized = true;
    logger.info('兴趣图谱已从默认种子初始化', {
      seeds: this.config.defaultSeeds,
      seedWeight,
    });
  }

  /**
   * 对所有兴趣应用时间衰减。
   * 衰减后低于 minWeight 的节点被移除（非归档——兴趣图谱量级小，直接移除）。
   * 衰减后若低于 minInterestCount，从 defaultSeeds 补充。
   */
  decayAll(): void {
    const now = Date.now();
    const beforeCount = this.data.nodes.length;

    this.data.nodes = this.data.nodes.filter((node) => {
      const effective = this.computeEffectiveWeight(node, now);
      return effective >= this.config.minWeight;
    });

    const removed = beforeCount - this.data.nodes.length;
    if (removed > 0) {
      logger.info('兴趣衰减后移除 dormant 节点', { removed, remaining: this.data.nodes.length });
    }

    // 确保数量下限
    this.ensureMinCount();

    // 更新 lastUpdated
    this.data.lastUpdated = new Date().toISOString();
  }

  /**
   * 确保兴趣数量不低于 minInterestCount。
   * 从 defaultSeeds 中补充尚未存在的种子。
   */
  private ensureMinCount(): void {
    const existingIds = new Set(this.data.nodes.map((n) => n.id));
    const now = new Date().toISOString();

    for (const seed of this.config.defaultSeeds) {
      if (this.data.nodes.length >= this.config.minInterestCount) {
        break;
      }
      if (!existingIds.has(seed)) {
        const seedWeight = Math.min(0.5, this.config.maxWeight);
        this.data.nodes.push({
          id: seed,
          weight: seedWeight,
          source: 'default',
          createdAt: now,
          lastReinforced: now,
          reinforceCount: 0,
        });
        logger.info('兴趣数量低于下限，从默认种子补充', { seed, weight: seedWeight });
      }
    }
  }

  // ----------------------------------------
  // 内部计算
  // ----------------------------------------

  /**
   * 计算有效权重（应用时间衰减）。
   * weight * exp(-λ * Δt_days)
   * 防御非法日期返回 0
   */
  private computeEffectiveWeight(node: InterestNode, nowMs: number): number {
    const lastReinforcedMs = new Date(node.lastReinforced).getTime();
    if (Number.isNaN(lastReinforcedMs)) {
      return 0;
    }
    const deltaDays = (nowMs - lastReinforcedMs) / (1000 * 60 * 60 * 24);
    const decayed = node.weight * Math.exp(-this.config.decayLambda * deltaDays);
    return Math.max(0, decayed);
  }
}

// ============================================
// 工厂 / 单例
// ============================================

function createDefaultGraphData(): InterestGraphData {
  return {
    version: GRAPH_VERSION,
    lastUpdated: new Date().toISOString(),
    nodes: [],
  };
}

/** 从 agent-config.json 的 interests 段构建配置 */
export function buildInterestConfig(
  partial?: Partial<InterestGraphConfig>
): InterestGraphConfig {
  return {
    ...DEFAULT_INTEREST_CONFIG,
    ...partial,
    defaultSeeds: partial?.defaultSeeds ?? DEFAULT_INTEREST_CONFIG.defaultSeeds,
  };
}

// 模块级单例缓存
const graphCache = new Map<string, InterestGraph>();

/**
 * 获取 InterestGraph 单例。
 * 按 filePath 复用实例（测试通过 DATA_DIR 环境变量隔离）。
 */
export function getInterestGraph(
  filePath?: string,
  config?: InterestGraphConfig
): InterestGraph {
  const path = filePath ?? getDataPath('interests.json');

  if (!graphCache.has(path)) {
    const cfg = config ?? buildInterestConfig();
    const graph = new InterestGraph(path, cfg);
    graphCache.set(path, graph);
  }

  return graphCache.get(path)!;
}

/**
 * 重置单例缓存（仅用于测试）。
 */
export function _resetInterestGraphCache(): void {
  graphCache.clear();
}

/**
 * 初始化兴趣图谱（启动时调用）。
 * 加载文件 → 空则 seedDefaults → 应用一次衰减 → 持久化。
 */
export async function initializeInterestGraph(
  config?: InterestGraphConfig
): Promise<InterestGraph> {
  const graph = getInterestGraph(undefined, config);
  await graph.load();

  if (!graph.isInitialized() && graph.getNodeCount() === 0) {
    graph.seedDefaults();
  } else if (graph.getNodeCount() > 0) {
    // 已有数据，标记为已初始化，避免后续 seedDefaults 覆盖
    (graph as unknown as { initialized: boolean }).initialized = true;
  }

  // 启动时应用一次衰减（清理过旧兴趣）
  graph.decayAll();
  await graph.persist();

  return graph;
}
