/**
 * 宠物 IP 生成管线领域类型（#94）
 *
 * 状态机（异步队列，PetGenProcessor tick 推进）：
 * spec_submitted → concept_generating → awaiting_confirmation →
 * generating_states → qc → done | failed
 *
 * 生成/视觉/切分全部接口化——测试注入 fake，真实实现见 qwen.ts / splitter.ts。
 */

import type { PetPresetId, PetStateId } from '@cyber-stray/shared/pet';
import type { ControlDb } from '../db/client.js';
import type { PetGenTask } from '../db/schema.js';

export type PetGenTaskStatus = PetGenTask['status'];

/** 生成策略（spike 结论：四宫格主路径，九宫格/逐状态回退） */
export type GenStrategy = 'quad' | 'nine' | 'per';

/** 用户提交的 spec：纯文本 + 选项 + 风格预设（web 表单 → CP API） */
export interface PetSpec {
  /** 角色描述纯文本（1-500 字符） */
  specText: string;
  /** 可选项：主色调 / 体型 / 补充备注 */
  options?: {
    palette?: string;
    size?: string;
    note?: string;
  };
  /** 风格预设 id（缺省 chibi-kawaii，见 shared PET_STYLE_PRESETS） */
  stylePreset?: PetPresetId;
}

/** 单状态质检结果 */
export interface StateQcResult {
  pass: boolean;
  issues: string[];
}

/** 图像生成请求 */
export interface ImageGenRequest {
  kind: 'concept' | 'grid';
  /** 优化后的 prompt（见 prompt.ts） */
  prompt: string;
  /** 输出路径（管线落盘用） */
  outPath: string;
  /** 参考图（白底 JPEG 路径；grid 生成 = 概念图锚点，ADR-0001 参考图锁角色） */
  reference?: string;
}

export interface ImageGenResult {
  imagePath: string;
}

/** 生图服务（真实实现见 qwen.ts；测试注入 fake） */
export interface ImageGenerator {
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}

/** 视觉质检请求（语义层：状态正确/角色一致/无文字水印/无畸形） */
export interface VisionQcRequest {
  /** 概念图路径（角色一致性锚点） */
  referencePath: string;
  /** 待检状态帧路径 */
  statePath: string;
  state: PetStateId;
  spec: PetSpec;
}

/** 视觉质检服务 */
export interface VisionQc {
  inspect(req: VisionQcRequest): Promise<StateQcResult>;
}

/** 结构质检（qc-structure.py 封装；校验 256px/透明底/内容占比 ≥20%） */
export interface StructureQc {
  inspect(
    statesDir: string,
    states: PetStateId[],
  ): Promise<Record<PetStateId, StateQcResult>>;
}

/** pet-sheet.py 封装：切分 / 概念归一 / 参考图压平 */
export interface Splitter {
  /**
   * cells 模式切分：网格图 → 每状态 1 帧 256px 透明 PNG（写入 outDir）。
   * emptyCells = 检测到的空格数（2x2 三状态布局下 0 = 模型画满 4 格 → 不顺从）。
   */
  splitGrid(
    gridPath: string,
    states: PetStateId[],
    opts: { cols: number; outDir: string },
  ): Promise<{ files: Record<PetStateId, string>; emptyCells: number }>;
  /** 概念图归一：抠绿幕 → 透明底整身 PNG（角色锚点） */
  normalizeConcept(srcPath: string, outPath: string, frame: number): Promise<string>;
  /** 参考图压平：透明 PNG → 白底 JPEG（Seedream image 字段 data URL 输入） */
  flattenReference(srcPath: string, outPath: string, frame: number): Promise<string>;
}

/** 处理器运行参数 */
export interface PetGenProcessorConfig {
  /** 当前策略连续批次失败后升级策略（quad→nine→per）的阈值 */
  maxBatchRetries: number;
  /** QC 重试轮数上限（超限仍有失败状态 → 整体失败，改 spec 重来） */
  maxQcRetries: number;
  /** 概念图归一边长（默认 512） */
  conceptFrame: number;
  /** 参考图压平边长（白底 JPEG 参考输入；默认 384） */
  referenceFrame: number;
  /** 网格生图尺寸（Seedream size 参数） */
  gridSize: string;
}

/** 处理器依赖（DB + 外部服务全部注入，测试可全 fake） */
export interface PetGenProcessorDeps {
  dataDir: string;
  db: ControlDb;
  imageGen: ImageGenerator;
  visionQc: VisionQc;
  structureQc: StructureQc;
  splitter: Splitter;
  config: PetGenProcessorConfig;
  now?: () => number;
}
