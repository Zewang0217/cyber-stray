/**
 * 生图 prompt 构建器（#94）：spec → 优化 prompt
 *
 * 确定性模板（不引入 LLM 依赖）：概念图 / 网格图 / 语义质检三类 prompt。
 * 遵循 ADR-0001 图文分离——画面 prompt 绝不让模型画文字/梗；
 * 固定绿幕 #00FF00（pet-sheet.py 抠图依据，spike §5）。
 */

import { PET_STATES, type PetStateId, type PetStylePreset } from '@cyber-stray/shared/pet';
import type { PetSpec } from './types.js';

/** 绿幕约束（所有画面 prompt 共用；与 pet-sheet.py chroma_key_green 阈值配套） */
const GREEN_SCREEN = '纯绿色背景(#00FF00)作为绿幕,角色完整可见,全身不出画布';

/** 通用禁止项（图文分离 + 防水印） */
const NEGATIVES = '不要文字,不要水印,不要签名,不要边框,不要其他物体,单一角色';

/** 可选选项拼进 prompt（存在才追加） */
function optionsFragment(spec: PetSpec): string {
  const { options } = spec;
  if (!options) return '';
  const parts: string[] = [];
  if (options.palette) parts.push(`主色调偏好:${options.palette}`);
  if (options.size) parts.push(`体型偏好:${options.size}`);
  if (options.note) parts.push(`补充:${options.note}`);
  return parts.length > 0 ? ` ${parts.join(',')}。` : '';
}

/**
 * 概念图 prompt：spec → 角色锚点（用户确认后锁角色，ADR-0001）。
 * 全身立绘 + 风格预设 + 选项，绿幕抠图出透明底概念图。
 */
export function buildConceptPrompt(spec: PetSpec, preset: PetStylePreset): string {
  return (
    `角色概念图:${spec.specText}。${preset.promptFragment}。` +
    `全身立绘,正面视角,表情友善,姿态自然。${optionsFragment(spec)}` +
    `${GREEN_SCREEN}。${NEGATIVES}。`
  );
}

/** 网格布局（spike 结论：四宫格主路径 / 九宫格备选 / 逐状态回退） */
export type GridLayout = '2x2' | '3x3' | '1x1';

/**
 * 网格图 prompt：同角色多状态单图（ADR-0001 单图多状态 + 静态帧）。
 * 2x2：3 状态 + 右下角留空 1 格（纯绿）；3x3：9 状态各占一格；1x1：单状态单图。
 */
export function buildGridPrompt(
  spec: PetSpec,
  preset: PetStylePreset,
  states: PetStateId[],
  layout: GridLayout,
): string {
  const names = states.map((s) => `${PET_STATES[s].label}(${s})`).join('、');
  const layoutHint =
    layout === '2x2'
      ? `一张 2x2 网格图,左上/右上/左下 3 格各画 1 个状态,右下角必须留空(纯绿色),网格线用细白线`
      : layout === '3x3'
        ? `一张 3x3 网格图,9 格各画 1 个状态,行优先,格子大小一致,网格线用细白线`
        : `一张单图,画面中央 1 个角色`;
  return (
    `同一个角色(${spec.specText})的${names}${states.length > 1 ? '共' : ''}${states.length}个动作状态,` +
    `画风保持一致:${preset.promptFragment}。${layoutHint},状态名顺序:${names}。` +
    `每个格子角色完整不出格,${GREEN_SCREEN}。${NEGATIVES}。`
  );
}

/** 语义质检 prompt（豆包视觉）：状态正确/角色一致/无文字水印/无畸形 */
export function buildQcPrompt(state: PetStateId, spec: PetSpec): string {
  return (
    `这张图应该展示宠物状态的"${PET_STATES[state].label}"(${state})。` +
    `角色描述:${spec.specText}。请严格按以下 JSON 格式回答(只输出 JSON):` +
    `{"pass": true/false, "issues": ["问题1", ...]}` +
    `。pass=false 当且仅当:1)动作/姿态明显不是该状态;` +
    `2)画面含文字、水印、签名或明显边框;` +
    `3)角色畸形(缺肢/断裂/模糊成一团);` +
    `4)角色与描述差异过大(物种/颜色/体型完全不同)。` +
    `若全部符合则 pass=true,issues 为空数组。`
  );
}
