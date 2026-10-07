/**
 * 宠物 IP 生成管线领域类型。
 *
 * 跨包契约（状态机 / spec / 质检结果 / API 视图）在 shared/petgen；此处保留
 * 管线内部接口——生成/视觉/切分全部接口化，测试注入 fake，真实实现见
 * qwen.ts / splitter.ts / structure-qc.ts。
 */

import type { TenantEvent } from '@cyber-stray/shared/tenant-events';
import type { PetPresetId, PetStateId } from '@cyber-stray/shared/pet';
import type { PetGenTaskStatus, PetSpec, StateQcResult } from '@cyber-stray/shared/petgen';
import type { ControlDb } from '../db/client.js';
import type { PetGenTask } from '../db/schema.js';
import type { PetUsageRecorder } from '../infra/usage.js';

/** 契约同源转发（既有 import 路径不变） */
export type { PetGenTaskStatus, PetSpec, StateQcResult };

/**
 * 生成策略。两条阶梯（按任务首策略决定，见 strategyLadder）：
 * - 领养精灵图（一致性问题单图化）：sheet(单张 n×n 全动作全帧) → strip(每动画一行 1×n)。
 *   不落到 per——单帧 256px 与 sheet 的 64px 帧尺寸不同构，混拼会毁掉 sprite 总条。
 * - 改造屋经典路径：布局/切分失败按 quad(2x2×3) → nine(3x3) → per(逐状态单帧)
 *   降级；内容 QC 失败直接逐态修复，保留已通过的图。
 */
export type GenStrategy = 'sheet' | 'strip' | 'quad' | 'nine' | 'per';

/** 领养精灵图策略阶梯（sheet 失败降级 strip：行内一致性仍在单图内保证） */
export const SHEET_STRATEGY_LADDER: readonly GenStrategy[] = ['sheet', 'strip'];

/** 改造屋经典策略阶梯（既有 quad→nine→per，spike 结论） */
export const CLASSIC_STRATEGY_LADDER: readonly GenStrategy[] = ['quad', 'nine', 'per'];

/** 任务当前策略所属的阶梯（升级沿阶梯走，不跨阶梯） */
export function strategyLadder(current: GenStrategy): readonly GenStrategy[] {
  return SHEET_STRATEGY_LADDER.includes(current) ? SHEET_STRATEGY_LADDER : CLASSIC_STRATEGY_LADDER;
}

/** 已收到成功 HTTP 响应，按请求实际模型记一次调用；必须在响应解析/落图前完成。 */
export type RecordProviderUsage = (model: string) => Promise<void>;

/** 图像生成请求 */
export interface ImageGenRequest {
  kind: 'concept' | 'grid' | 'sheet';
  /** 优化后的 prompt（见 prompt.ts） */
  prompt: string;
  /** 输出路径（管线落盘用） */
  outPath: string;
  /** 参考图（白底 JPEG 路径；grid/sheet 生成 = 角色锚点，ADR-0001 参考图锁角色） */
  reference?: string;
  onUsage?: RecordProviderUsage;
}

export interface ImageGenResult {
  imagePath: string;
}

/** 生图服务（真实实现见 qwen.ts；测试注入 fake） */
export interface ImageGenerator {
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}

/** 视觉质检请求（语义层：状态正确/角色一致/无文字水印/无畸形；frames>1 加帧间连贯性） */
export interface VisionQcRequest {
  /** 概念图/参考图路径（角色一致性锚点） */
  referencePath: string;
  /** 待检状态帧路径（横排帧条时为整条） */
  statePath: string;
  state: PetStateId;
  spec: PetSpec;
  /** 帧数（≥2 = 横排动画帧条，质检含帧间角色/动作连贯；缺省 1 = 单帧） */
  frames?: number;
  onUsage?: RecordProviderUsage;
}

/** 视觉质检服务 */
export interface VisionQc {
  inspect(req: VisionQcRequest): Promise<StateQcResult>;
}

/** 结构质检（qc-structure.py 封装；校验帧尺寸/透明底/内容占比 ≥20%） */
export interface StructureQc {
  inspect(
    statesDir: string,
    states: PetStateId[],
    opts?: {
      /** 单帧边长（缺省 256；精灵图路径传 64） */
      frame?: number;
      /** 各状态帧数（横排帧条；缺省 1） */
      frames?: Partial<Record<PetStateId, number>>;
    },
  ): Promise<Record<PetStateId, StateQcResult>>;
}

/** splitSheet 产出（pet-sheet.py --sheet 的 meta 报告） */
export interface SheetSplitResult {
  /** 每动画帧条路径 + 帧数（frames 为切分实报；manifest 帧表以 PET_SHEET_ANIMS 声明值为准） */
  files: Record<string, string>;
  frames: Record<string, number>;
  /** 空格数（>0 = 模型漏格 → 策略失败信号） */
  emptyCells: number;
  /** 每动画每格内容占比（诊断/QC 参考） */
  ratios: Record<string, number[]>;
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
  /**
   * sheet 模式切分：单张 R×C 全动作全帧 → 每动画横排帧条 + sprite.png 总条
   * （确定性等分，格边界是约定非检测）。sheet=方阵 rows=cols=n；strip 降级=1×N 行条。
   * frames 以脚本实报为准。
   */
  splitSheet(
    gridPath: string,
    opts: {
      rows: number;
      cols: number;
      anims: ReadonlyArray<{ state: PetStateId; frames: number }>;
      frame: number;
      outDir: string;
    },
  ): Promise<SheetSplitResult>;
  /**
   * 总条重建：strip 逐动画重生成后，把 outDir 已有帧条按全动画次序重新拼接
   * 为 sprite.png（splitSheet 每次只写本次动画的总条，逐动画调用会互相覆盖）。
   */
  joinSprite(
    outDir: string,
    anims: ReadonlyArray<{ state: PetStateId; frames: number }>,
    frame: number,
  ): Promise<void>;
  /**
   * 送审放大：NEAREST ×N 输出 <stem>.qc.png 到 outDir（返回完整路径）。
   * 基准测试实证：64px 帧条直接送审视觉模型会漏检/误判，×4 后判定与人眼一致。
   */
  upscaleForQc(srcPath: string, outDir: string, factor: number): Promise<string>;
  /** 概念图归一：抠绿幕 → 透明底整身 PNG（角色锚点） */
  normalizeConcept(srcPath: string, outPath: string, frame: number): Promise<string>;
  /** 参考图压平：透明 PNG → 白底 JPEG（Seedream image 字段 data URL 输入） */
  flattenReference(srcPath: string, outPath: string, frame: number): Promise<string>;
}

/** 处理器运行参数 */
export interface PetGenProcessorConfig {
  /** 当前策略连续批次失败后升级策略（沿 strategyLadder）的阈值 */
  maxBatchRetries: number;
  /** QC 重试轮数上限（超限仍有失败状态 → 整体失败，改 spec 重来） */
  maxQcRetries: number;
  /**
   * 视觉质检「基础设施异常」（API 断连/key 失效/输出坏格式）连续轮数上限。
   * 与内容不合格分开计：infra 异常不消耗 qcRetries、不触发生图重生成，
   * 只重试质检调用本身；超限整体失败并带真实异常文案。
   */
  maxQcInfraRetries: number;
  /** 概念图归一边长（默认 512） */
  conceptFrame: number;
  /** 参考图压平边长（白底 JPEG 参考输入；默认 384） */
  referenceFrame: number;
  /** 网格生图尺寸（Seedream size 参数） */
  gridSize: string;
}

/** 事件发布（结构最小面，与 EventBus.publish 同形；缺省 = 不发布，测试友好） */
export interface PetGenEventPublisher {
  publish(tenantId: string, event: TenantEvent): void;
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
  /** 用量记录（生产装配必须提供；无付费调用的测试 fake 可省略） */
  usage?: PetUsageRecorder;
  /** 事件总线（pet_assets_ready 发布；缺省 = 不发布） */
  bus?: PetGenEventPublisher;
}
