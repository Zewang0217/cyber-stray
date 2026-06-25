/**
 * 反思模块类型定义 + Zod schema
 *
 * Phase 4 (REF-01/02/03)：反思回路把碎片观察合成为洞察记忆，并更新兴趣图谱。
 *
 * 关键约束：
 * - 反思只读原始观察（provenance = untrusted:web），排除自身产出的洞察（防自激）
 * - 每条洞察必须引用 ≥1 条来源 memoryId（grounding），无源丢弃
 * - LLM 输出经 Zod 严格校验，非法字段整条丢弃
 */

import { z } from 'zod';

// ============================================
// Provenance（来源可信度标记）
// ============================================

/**
 * 记忆来源标记。
 * - untrusted:web — 来自网页浏览的原始观察（默认）
 * - self:reflection — 反思引擎产出的合成洞察
 */
export type Provenance = 'untrusted:web' | 'self:reflection';

/** 默认 provenance——未标记的记忆均视为来自 web */
export const DEFAULT_PROVENANCE: Provenance = 'untrusted:web';

// ============================================
// Zod Schemas（反思 LLM 输出）
// ============================================

/** 单条新兴趣提议 */
export const NewInterestSchema = z.object({
  topic: z.string().min(1).max(30),
  /** 初始权重 0-0.5（反思产出不应过高，留给反馈逐步强化） */
  weight: z.number().min(0).max(0.5),
  reasoning: z.string().min(1).max(200),
});

/** 已有兴趣的权重调整 */
export const InterestUpdateSchema = z.object({
  topic: z.string().min(1).max(30),
  /** 权重变化量，负为衰减，正为强化，限制幅度防跳变 */
  delta: z.number().min(-0.1).max(0.2),
  reasoning: z.string().min(1).max(200),
});

/** 单条反思洞察 */
export const ReflectionInsightSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(500),
  /** 引用来源 memoryId 列表，必须 ≥1（grounding） */
  sourceIds: z.array(z.string().min(1)).min(1).max(10),
  /** 反思发现的新兴趣（可选） */
  newInterests: z.array(NewInterestSchema).max(3),
  /** 对已有兴趣的权重调整（可选） */
  existingInterestUpdates: z.array(InterestUpdateSchema).max(5),
});

/** 反思 LLM 输出的顶层结构 */
export const ReflectionResultSchema = z.object({
  insights: z.array(ReflectionInsightSchema).min(0).max(10),
  /** 本次反思的元摘要（供未来反思回溯） */
  summary: z.string().max(300),
});

// ============================================
// Types（从 Zod 推导）
// ============================================

export type NewInterest = z.infer<typeof NewInterestSchema>;
export type InterestUpdate = z.infer<typeof InterestUpdateSchema>;
export type ReflectionInsight = z.infer<typeof ReflectionInsightSchema>;
export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;

// ============================================
// 反思配置
// ============================================

export interface ReflectionConfig {
  /** 每 N 次游荡触发一次反思 */
  wanderInterval: number;
  /** 或每 M 小时触发（取先到者） */
  hourInterval: number;
  /** 最多喂入反思的观察条数 */
  maxObservations: number;
  /** 回看天数 */
  lookbackDays: number;
  /** 每次反思最多产出的洞察数 */
  maxInsights: number;
  /** 主开关 */
  enabled: boolean;
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  wanderInterval: 5,
  hourInterval: 4,
  maxObservations: 30,
  lookbackDays: 7,
  maxInsights: 5,
  enabled: true,
};

// ============================================
// 调度器状态
// ============================================

export interface SchedulerState {
  /** 累计游荡次数（模 wanderInterval 用） */
  wanderCount: number;
  /** 上次反思时间 */
  lastReflectionAt: string | null;
  /** 累计反思次数 */
  totalReflections: number;
}

export function createDefaultSchedulerState(): SchedulerState {
  return {
    wanderCount: 0,
    lastReflectionAt: null,
    totalReflections: 0,
  };
}
