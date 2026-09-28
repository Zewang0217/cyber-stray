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

/**
 * 精灵图逐帧姿态提示（PET_SHEET_ANIMS 全集；确定性模板的一部分）。
 * 每格内容锁死到词面——「连续 N 帧自由发挥」是格间漂移主因。
 */
const SHEET_FRAME_HINTS: Record<PetStateId, string> = {
  idle: '第1帧正常坐姿,第2帧身体微微鼓起(吸气),第3帧回到正常坐姿,第4帧身体微微压低(呼气)',
  walk: '侧面朝左行走的走路循环:第1帧迈出左前腿,第2帧四腿收拢中间过渡,第3帧迈出右后腿,第4帧回到中间过渡',
  sleep: '第1帧闭眼趴下头贴地,第2帧头微微点动一下',
  grumpy: '第1帧把头别向一边不理人,第2帧斜眼瞪回来',
  joy: '第1帧原地小跳起(四脚离地),第2帧落地眼睛弯成月牙',
  welcome: '第1帧举起右前爪打招呼,第2帧放下爪子',
  celebrate: '第1帧跳起双爪上举,第2帧落地开心张望',
  eat: '第1帧低头咬一口,第2帧抬头咀嚼',
  think: '第1帧歪头凝视,第2帧头回正',
};

/** sheet prompt 行描述取用（processor/strip 调用；逐帧姿态提示表） */
export function sheetRowOf(state: PetStateId): { label: string; hint: string } {
  const spec = PET_STATES[state];
  if (!spec) {
    throw new Error(`未知宠物状态: ${String(state)}（注册表 PET_STATES 中不存在）`);
  }
  return { label: spec.label, hint: SHEET_FRAME_HINTS[state] };
}

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

/** 网格图 prompt：同角色多状态单图（ADR-0001 单图多状态 + 静态帧）。
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

// ── 领养精灵图（sheet/strip）──
// 一致性方案：单张图承载全部动作全部帧，角色一致靠「同一次生成」而非参考图串联。
// 帧姿态逐格显式描述——模型对「连续动画帧」的自由发挥是格间漂移主因，锁死每格内容。

/** 精灵图布局约束（sheet/strip 共用；确定性等分切分的约定前提） */
const SHEET_LAYOUT_RULES =
  '严格按网格排布,格子大小完全一致,网格线用细白线,每个格子角色大小一致、全身完整不出格,' +
  '所有格子的脚底都贴在同一水平线上,行优先排列';

/**
 * 精灵图整张 prompt：单张 n×n 承载全部动作全部帧（领养路径主策略）。
 * 动画按帧数打包进网格行（每行累计帧数 ≤ n，行内从左到右排）——当前
 * 4×4 集打包为 idle 行 / walk 行 / [sleep|grumpy] 行 / [joy|welcome] 行，
 * 16 帧恰好填满无空格（空位指令不顺从是 quad 路径主失败因，全填满直接
 * 消除该失败模式）。描述的行数必须与网格一致——否则模型画 6 行、切分按
 * 4 行等分，第 3 行起全部错位（真机验证抓过的 bug）。
 */
export function buildSheetPrompt(
  spec: PetSpec,
  preset: PetStylePreset,
  anims: ReadonlyArray<{ state: PetStateId; frames: number }>,
  grid: number,
): string {
  const total = anims.reduce((sum, a) => sum + a.frames, 0);
  if (total !== grid * grid) {
    throw new Error(
      `精灵图动画集帧数总和 ${total} != ${grid}x${grid}=${grid * grid}（PET_SHEET_ANIMS 与网格不符）`,
    );
  }
  const rows: PetStateId[][] = [];
  let current: PetStateId[] = [];
  let currentFrames = 0;
  for (const a of anims) {
    if (currentFrames + a.frames > grid) {
      rows.push(current);
      current = [];
      currentFrames = 0;
    }
    current.push(a.state);
    currentFrames += a.frames;
  }
  if (current.length > 0) rows.push(current);
  if (rows.length > grid) {
    throw new Error(`精灵图动画集需 ${rows.length} 行，超过 ${grid}×${grid} 网格行数`);
  }
  const rowDesc = rows
    .map((row, i) => {
      const parts = row.map(
        (s) => `${PET_STATES[s].label}(${s})连续帧:${sheetRowOf(s).hint}`,
      );
      return `第${i + 1}行共${grid}格,从左到右:${parts.join(';')}`;
    })
    .join(';');
  return (
    `同一个角色(${spec.specText})的像素游戏精灵图(sprite sheet),一张 ${grid}x${grid} 网格图,` +
    `恰好${grid}行每行${grid}格,${grid * grid} 格全部填满。${rowDesc}。${SHEET_LAYOUT_RULES}。` +
    `画风保持一致:${preset.promptFragment}。${GREEN_SCREEN}。${NEGATIVES}。`
  );
}

/**
 * 精灵图单动画横排 prompt（strip 降级策略：某动画重生成,1×n 一行连续帧）。
 * 行内一致性仍在单图内保证——这是 sheet 失败后仍优于逐状态的原因。
 */
export function buildStripPrompt(
  spec: PetSpec,
  preset: PetStylePreset,
  label: string,
  frames: number,
  hint: string,
): string {
  return (
    `同一个角色(${spec.specText})的像素游戏动画帧条,一张 1 行 ${frames} 列的横排网格图,` +
    `从左到右是${label}的连续${frames}帧:${hint}。${SHEET_LAYOUT_RULES}。` +
    `画风保持一致:${preset.promptFragment}。${GREEN_SCREEN}。${NEGATIVES}。`
  );
}

/**
 * 精灵图动画帧条语义质检 prompt（frames≥2：加帧间连贯性判定）。
 * 一致性锚定参考图（输入第一张图，ADR-0001）——spec 文字只作辅助语境。
 */
export function buildAnimQcPrompt(state: PetStateId, frames: number, spec: PetSpec): string {
  return (
    `第一张图是该角色的参考图。第二张图是从左到右横排的 ${frames} 帧动画帧条,` +
    `应展示宠物状态的"${PET_STATES[state].label}"(${state})的连续动作。` +
    `角色补充语境:${spec.specText}。请严格按以下 JSON 格式回答(只输出 JSON):` +
    `{"pass": true/false, "issues": ["问题1", ...]}` +
    `。pass=false 当且仅当:1)动作/姿态明显不是该状态;` +
    `2)帧条角色与第一张参考图差异过大(物种/颜色/体型完全不同;画风差异不算);` +
    `3)帧间角色的物种/主配色/体型发生明显跳变,或某帧角色缺失、多出别的角色` +
    `(注意:帧间姿态、大小、朝向的差异是动画的正常表现,不算不一致);` +
    `4)画面含文字、水印、签名或明显边框;` +
    `5)角色畸形(缺肢/断裂/模糊成一团)。` +
    `若全部符合则 pass=true,issues 为空数组。`
  );
}

/** 语义质检 prompt（豆包视觉）：状态正确/与参考图一致/无文字水印/无畸形。
 *  一致性锚定参考图（输入第一张图，ADR-0001 参考图锁角色）——spec 文字只作
 *  辅助语境，不作为比对基准（领养 spec 是性格/兴趣描述，无法作视觉锚点，
 *  E2E 抓过按文字比对恒判「差异过大」的问题）。 */
export function buildQcPrompt(state: PetStateId, spec: PetSpec): string {
  return (
    `第一张图是该角色的参考图。第二张图是单帧画面,应展示宠物状态的"${PET_STATES[state].label}"(${state})。` +
    `角色补充语境:${spec.specText}。请严格按以下 JSON 格式回答(只输出 JSON):` +
    `{"pass": true/false, "issues": ["问题1", ...]}` +
    `。pass=false 当且仅当:1)动作/姿态明显不是该状态;` +
    `2)画面含文字、水印、签名或明显边框;` +
    `3)角色畸形(缺肢/断裂/模糊成一团);` +
    `4)第二张图的角色与第一张参考图差异过大(物种/颜色/体型完全不同;画风差异不算)。` +
    `若全部符合则 pass=true,issues 为空数组。`
  );
}
