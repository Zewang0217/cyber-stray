/**
 * 反思引擎（ReflectionEngine）
 *
 * Phase 4 (REF-01/02/03)：核心组件——LLM 驱动的碎片观察 → 合成洞察。
 *
 * 流程：
 * 1. 收集原始观察（provenance ≠ self:reflection）
 * 2. 构建反思 prompt → LLM generateText
 * 3. JSON.parse → Zod 校验 → grounding 验证
 * 4. 写入洞察记忆（provenance = self:reflection）
 * 5. 更新 InterestGraph（source = 'reflection'）
 *
 * 防自激：
 * - 只读 provenance = untrusted:web（或未标记）的 observation
 * - 产出记忆标记 provenance = self:reflection，不被下次反思读入
 *
 * 防幻觉：
 * - 每条洞察必须引用 ≥1 条 source memoryId（Zod min(1)）
 * - grounding 验证 sourceId 对应的 observation 确实存在
 * - 无源/低支撑的洞察整条丢弃
 */

import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { getMemoryStore } from '../long-term/index.js';
import { getInterestGraph } from '../interest-graph.js';
import type { MemoryEntry } from '../long-term/types.js';
import {
  ReflectionResultSchema,
  DEFAULT_REFLECTION_CONFIG,
} from './types.js';
import type {
  ReflectionConfig,
  ReflectionResult,
  ReflectionInsight,
} from './types.js';

const logger = consola.withTag('ReflectionEngine');

/** 反思用的 system prompt */
function buildReflectionSystemPrompt(): string {
  return `你是一只赛博街溜子的"反思大脑"。你的任务是阅读宠物在互联网上游荡时记录下来的**原始观察**，从中发现规律、趋势和洞察。

你需要输出 JSON 格式的反思结果，包含：
- insights[]: 洞察列表，每条包含 title（标题）、content（内容）、sourceIds（引用的观察 ID 列表，至少 1 条）、newInterests（发现的新兴趣）、existingInterestUpdates（对已有兴趣的调整）
- summary: 本次反思的一句话摘要

**重要原则：**
1. 只从给定的观察中推导，不要凭空编造
2. 每条洞察必须关联至少一条来源观察（sourceIds）
3. 不要对单条观察过度解读——找跨多条的规律
4. 新兴趣的权重不要超过 0.5，控制在谨慎水平
5. 兴趣调整幅度要小（delta -0.1 到 +0.2）
6. 如果观察不足以得出任何洞察，返回空 insights 数组

**输出格式：纯 JSON，不要 markdown 代码块包裹**`;
}

/** 反思用的 user prompt */
function buildReflectionUserPrompt(observations: MemoryEntry[], maxInsights: number): string {
  const formatted = observations.map((obs, i) => {
    const domain = extractDomain(obs);
    return `[${i + 1}] ID: ${obs.id}
   时间: ${obs.timestamp}
   来源域名: ${domain || '未知'}
   标题: ${obs.summary}
   内容: ${obs.content.substring(0, 300)}`;
  }).join('\n\n---\n\n');

  return `以下是宠物最近记录下的 ${observations.length} 条原始观察：

${formatted}

请基于以上观察，输出最多 ${maxInsights} 条洞察。如果观察不够形成有意义洞察，返回空数组。

直接输出 JSON（不要 markdown 代码块）：`;
}

/** 从记忆内容中尝试提取来源域名 */
function extractDomain(entry: MemoryEntry): string {
  const urlMatch = entry.content.match(/https?:\/\/([^\s/"]+)/);
  return urlMatch?.[1] ?? '';
}

/** 反思引擎执行结果 */
export interface ReflectionResult2 {
  /** 是否成功执行了反思 */
  executed: boolean;
  /** 产出的洞察数 */
  insightsProduced: number;
  /** 因无源被丢弃的洞察数 */
  insightsDiscardedByGrounding: number;
  /** 因 Zod 校验失败丢弃的洞察数 */
  insightsDiscardedByValidation: number;
  /** 新添加的兴趣 */
  newInterestsAdded: string[];
  /** 更新的已有兴趣 */
  existingInterestsUpdated: string[];
}

/** 空反思结果 */
const EMPTY_RESULT: ReflectionResult2 = {
  executed: false,
  insightsProduced: 0,
  insightsDiscardedByGrounding: 0,
  insightsDiscardedByValidation: 0,
  newInterestsAdded: [],
  existingInterestsUpdated: [],
};

// ============================================
// ReflectionEngine
// ============================================

export class ReflectionEngine {
  private cfg: ReflectionConfig;

  constructor(cfg?: Partial<ReflectionConfig>) {
    this.cfg = { ...DEFAULT_REFLECTION_CONFIG, ...cfg };
  }

  /**
   * 执行一次反思。
   *
   * 失败抛错，由调用方（scheduler）try/catch 处理。
   * 观察不足时返回空结果（不是错误——"没什么可反思"是正常状态）。
   */
  async reflect(): Promise<ReflectionResult2> {
    if (!this.cfg.enabled) {
      logger.debug('反思引擎已禁用，跳过');
      return EMPTY_RESULT;
    }

    // Step 1: 收集原始观察（排除自身产出的洞察）
    const observations = await this.collectObservations();
    if (observations.length < 3) {
      logger.debug('原始观察不足（< 3），跳过反思', { count: observations.length });
      return EMPTY_RESULT;
    }

    // Step 2: 调用 LLM 反思
    const rawOutput = await this.callLLM(observations);

    // Step 3: 解析 + Zod 校验
    const parseResult = this.parseAndValidate(rawOutput);
    if (!parseResult.success || parseResult.result.insights.length === 0) {
      logger.info('反思未产出有效洞察', {
        parseSuccess: parseResult.success,
        discardedByValidation: parseResult.discardedCount,
      });
      return {
        ...EMPTY_RESULT,
        executed: true,
        insightsDiscardedByValidation: parseResult.discardedCount,
      };
    }

    // Step 4: grounding 验证 + 裁剪到 maxInsights
    const groundedInsights = this.groundInsights(
      parseResult.result.insights.slice(0, this.cfg.maxInsights),
      observations,
    );

    if (groundedInsights.length === 0) {
      logger.info('所有洞察因 grounding 失败被丢弃', {
        original: parseResult.result.insights.length,
      });
      return {
        ...EMPTY_RESULT,
        executed: true,
        insightsDiscardedByGrounding: parseResult.result.insights.length,
        insightsDiscardedByValidation: parseResult.discardedCount,
      };
    }

    // Step 5: 写入洞察记忆
    const writtenCount = await this.writeInsights(groundedInsights);

    // Step 6: 更新兴趣图谱
    const { newAdded, updated } = await this.updateInterestGraph(groundedInsights);

    logger.info('反思完成', {
      observationsFed: observations.length,
      insightsProduced: writtenCount,
      groundedDiscarded: parseResult.result.insights.length - groundedInsights.length,
      newInterests: newAdded,
      updatedInterests: updated,
      summary: parseResult.result.summary,
    });

    return {
      executed: true,
      insightsProduced: writtenCount,
      insightsDiscardedByGrounding:
        parseResult.result.insights.length - groundedInsights.length,
      insightsDiscardedByValidation: parseResult.discardedCount,
      newInterestsAdded: newAdded,
      existingInterestsUpdated: updated,
    };
  }

  // ==========================================
  // Private
  // ==========================================

  /** 收集最近原始观察，排除 provenance = self:reflection 的条目 */
  private async collectObservations(): Promise<MemoryEntry[]> {
    const store = getMemoryStore();
    const since = new Date(
      Date.now() - this.cfg.lookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const all = await store.getRecentMemories({
      type: 'observation',
      count: this.cfg.maxObservations,
      since,
    });

    // 过滤掉反思自身产出的洞察
    return all.filter((m) => m.provenance !== 'self:reflection');
  }

  /** 调用 LLM 反思，返回原始文本 */
  private async callLLM(observations: MemoryEntry[]): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('缺少环境变量 DEEPSEEK_API_KEY');
    }

    const provider = createDeepSeek({ apiKey });
    const systemPrompt = buildReflectionSystemPrompt();
    const userPrompt = buildReflectionUserPrompt(observations, this.cfg.maxInsights);

    logger.debug('发起反思 LLM 调用', { observationCount: observations.length });

    const result = await generateText({
      model: provider.chat(config.llmModel),
      temperature: 0.4, // 反思需要一致性高于创造性
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 3000,
    });

    return result.text.trim();
  }

  /** 解析 LLM 输出为 ReflectionResult */
  private parseAndValidate(raw: string): {
    success: boolean;
    result: ReflectionResult;
    discardedCount: number;
  } {
    // 剥离可能的 markdown 代码块包裹（start/end 匹配替代 lazy regex，防止
    // insight content 中的 ``` 导致提前截断）
    let jsonStr = raw.trim();
    for (const fence of ['```json', '```']) {
      if (jsonStr.startsWith(fence) && jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(fence.length, -3).trim();
        break;
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (error) {
      logger.error('反思 LLM 输出不是合法 JSON', { error, rawPreview: raw.slice(0, 200) });
      return { success: false, result: { insights: [], summary: '' }, discardedCount: 0 };
    }

    const result = ReflectionResultSchema.safeParse(parsed);
    if (!result.success) {
      logger.error('反思输出 Zod 校验失败', { issues: result.error.issues });

      // 尝试部分恢复：逐个校验 insight，丢弃不合法的
      const rawData = parsed as Record<string, unknown>;
      const rawInsights = Array.isArray(rawData.insights) ? rawData.insights : [];
      const validInsights: ReflectionInsight[] = [];
      let discardedCount = 0;

      for (const item of rawInsights) {
        const insightResult = ReflectionResultSchema.shape.insights.element.safeParse(item);
        if (insightResult.success) {
          validInsights.push(insightResult.data);
        } else {
          discardedCount++;
        }
      }

      if (validInsights.length > 0) {
        logger.info('部分恢复：Zod 校验失败但部分 insight 合法', {
          valid: validInsights.length,
          discarded: discardedCount,
        });
        return {
          success: true,
          result: {
            insights: validInsights,
            summary: typeof rawData.summary === 'string' ? rawData.summary : '',
          },
          discardedCount,
        };
      }

      return { success: false, result: { insights: [], summary: '' }, discardedCount };
    }

    return { success: true, result: result.data, discardedCount: 0 };
  }

  /** grounding 验证：每条洞察的 sourceIds 必须对应真实存在的观察 */
  private groundInsights(
    insights: ReflectionInsight[],
    observations: MemoryEntry[],
  ): ReflectionInsight[] {
    const observationIds = new Set(observations.map((o) => o.id));

    return insights.filter((insight) => {
      const validSources = insight.sourceIds.filter((sid) => observationIds.has(sid));
      if (validSources.length === 0) {
        logger.warn('洞察因 grounding 失败被丢弃（无有效 sourceId）', {
          title: insight.title,
          claimedSources: insight.sourceIds,
        });
        return false;
      }
      // 原地修正 sourceIds 为已验证的（防御 LLM 编造 id 但恰好命中）
      insight.sourceIds = validSources;
      return true;
    });
  }

  /** 将洞察写入 long-term memory（provenance = self:reflection） */
  private async writeInsights(insights: ReflectionInsight[]): Promise<number> {
    const store = getMemoryStore();
    let written = 0;

    for (const insight of insights) {
      try {
        await store.saveMemory({
          type: 'observation',
          timestamp: new Date().toISOString(),
          tags: ['reflection', 'insight', ...insight.sourceIds.slice(0, 3).map((id) => `ref:${id}`)],
          summary: `[反思洞察] ${insight.title}`,
          content: `${insight.content}\n\n引用来源: ${insight.sourceIds.join(', ')}`,
          importance: 0.7,
          provenance: 'self:reflection',
        });
        written++;
      } catch (error) {
        logger.error('写入洞察记忆失败', { error, title: insight.title });
      }
    }

    return written;
  }

  /** 将洞察中的兴趣变更应用到 InterestGraph */
  private async updateInterestGraph(
    insights: ReflectionInsight[],
  ): Promise<{ newAdded: string[]; updated: string[] }> {
    const newAdded: string[] = [];
    const updated: string[] = [];

    try {
      const graph = getInterestGraph();
      if (!graph.isInitialized() && graph.getNodeCount() === 0) {
        await graph.load();
      }

      for (const insight of insights) {
        // 添加新兴趣
        for (const ni of insight.newInterests) {
          if (graph.getNode(ni.topic)) {
            // 已存在，改为更新
            updated.push(ni.topic);
            graph.reinforce(ni.topic, ni.weight * 0.5); // 反思建议的权重打折
          } else {
            const added = graph.addInterest(ni.topic, ni.weight, 'reflection');
            if (added) {
              newAdded.push(ni.topic);
            }
          }
        }

        // 更新已有兴趣
        for (const iu of insight.existingInterestUpdates) {
          const node = graph.getNode(iu.topic);
          if (node) {
            if (iu.delta > 0) {
              graph.reinforce(iu.topic, iu.delta);
            } else {
              // 衰减
              const newWeight = Math.max(0, node.weight + iu.delta);
              node.weight = newWeight;
              node.lastReinforced = new Date().toISOString();
            }
            updated.push(iu.topic);
          }
        }
      }

      await graph.persist();
    } catch (error) {
      logger.error('更新兴趣图谱失败', { error });
    }

    return { newAdded, updated };
  }
}

/** 模块级单例 */
let defaultEngine: ReflectionEngine | null = null;

export function getReflectionEngine(cfg?: Partial<ReflectionConfig>): ReflectionEngine {
  if (!defaultEngine) {
    defaultEngine = new ReflectionEngine(cfg);
  }
  return defaultEngine;
}

/** 重置单例（测试隔离） */
export function _resetReflectionEngine(): void {
  defaultEngine = null;
}
