/**
 * 宠物 IP 定制（petgen）跨包契约：CP 状态机 / DB 列 / API 视图，web 表单与轮询渲染。
 */

import type { PetPresetId, PetStateId } from './pet';

/**
 * 任务状态机：spec_submitted → concept_generating → awaiting_confirmation →
 * generating_states → qc → done | failed。
 * drizzle enum 列写 `[...PET_GEN_TASK_STATUSES]`（与 PET_MOODS 同款），DB 列类型与本清单同源。
 */
export const PET_GEN_TASK_STATUSES = [
  'spec_submitted',
  'concept_generating',
  'awaiting_confirmation',
  'generating_states',
  'qc',
  'done',
  'failed',
] as const;

export type PetGenTaskStatus = (typeof PET_GEN_TASK_STATUSES)[number];

/** 单状态质检结果 */
export interface StateQcResult {
  pass: boolean;
  issues: string[];
}

/** 用户提交的 spec（web 表单 → CP POST /api/petgen/tasks） */
export interface PetSpec {
  /** 角色描述纯文本（1-500 字符） */
  specText: string;
  /** 可选项：主色调 / 体型 / 补充备注 */
  options?: {
    palette?: string;
    size?: string;
    note?: string;
  };
  /** 风格预设 id（缺省见 shared/pet 的 PET_STYLE_PRESETS） */
  stylePreset?: PetPresetId;
}

/** 任务 API 视图（CP toTaskView 构造 → web 轮询渲染） */
export interface PetGenTaskView {
  id: string;
  status: PetGenTaskStatus;
  specText: string;
  options?: { palette?: string; size?: string; note?: string };
  stylePreset: PetPresetId;
  /** 概念图 URL（awaiting_confirmation 起存在） */
  conceptUrl: string | null;
  error: string | null;
  qcResult: Record<PetStateId, StateQcResult> | null;
  conceptAttempts: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** done 后的成品素材根（/api/petgen/assets 前缀） */
  assetBase: string | null;
}

/** 月度配额视图（GET /api/petgen/quota）；非 Pro/BYOK → available:false 全 0 */
export interface PetGenQuota {
  available: boolean;
  limit: number;
  used: number;
  remaining: number;
  /** 重置月（YYYY-MM）；available:false 时缺省 */
  resetAt?: string;
}
