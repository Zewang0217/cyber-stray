/**
 * 宠物 IP 生成任务处理器（#94 / 领养精灵图）—— 异步队列状态机
 *
 * tick() 每间隔推进一个待办任务（单 tick 单任务 + 租户隔离：同租户已有
 * 在飞任务则跳过，天然防并发写租户目录）：
 *
 *   spec_submitted → concept_generating → awaiting_confirmation →
 *   generating_states → qc → done | failed
 *
 * 两条路径：
 * - 改造屋（经典）：概念图用户确认锚点（ADR-0001）→ quad/nine/per 阶梯 →
 *   9 状态单帧 256px（frames=1）。
 * - 领养精灵图（sheet/strip 阶梯）：一致性单图化——单张 n×n 承载全部动作
 *   全部帧（角色一致靠同一次生成）；awaiting_confirmation 自动跳过（领养
 *   不阻塞，错一张的成本远低于打断仪式）；切分走 pet-sheet.py --sheet
 *   确定性等分；有上传参考图时跳过概念图直接以其为角色锚点。不落到
 *   per——单帧 256px 与 sheet 64px 帧不同构，混拼会毁掉 sprite 总条。
 * - QC 两层共用：结构（qc-structure.py，--frame/--frames 参数化）+ 语义
 *   （GLM-4V，frames≥2 时加帧间连贯性判定）。
 * - 素材落 data/tenants/<sub>/pet-assets/（manifest + 状态 PNG + 概念图）。
 *   领养路径 manifest 带 sprite 块（横排总条 + 帧表），done 后发
 *   pet_assets_ready 事件（web 拉 manifest 换形象）。
 */

import { access, copyFile, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_PET_PRESET,
  PET_SHEET_ANIMS,
  PET_SHEET_FRAME,
  PET_SHEET_GRID,
  PET_SHEET_STATE_IDS,
  PET_STATES,
  PET_STATE_IDS,
  PET_STYLE_PRESETS,
  type PetPresetId,
  type PetStateId,
} from '@cyber-stray/shared/pet';
import { parseStoredQcResult } from '@cyber-stray/shared/petgen';
import { petGenTasks, type PetGenTask } from '../db/schema.js';
import { findPetByTenant } from '../infra/pets-repo.js';
import { tenantDataDir } from '../infra/tenant.js';
import { assertUsageHealthy, UsageAccountingError } from '../infra/usage.js';
import { buildConceptPrompt, buildGridPrompt, buildSheetPrompt, buildStripPrompt, sheetRowOf } from './prompt.js';
import {
  CLASSIC_STRATEGY_LADDER,
  type GenStrategy,
  type PetGenProcessorDeps,
  type PetSpec,
  type RecordProviderUsage,
  type StateQcResult,
  strategyLadder,
} from './types.js';

/** 改造屋布局/切分失败的策略阶梯（quad→nine→per） */
const STRATEGY_ORDER = CLASSIC_STRATEGY_LADDER;
const PROVIDER_CONCURRENCY = 2;

/** Bound independent provider requests; stop scheduling on error and drain in-flight calls. */
async function forEachProviderBounded<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const item = items[cursor++]!;
      try { await run(item); }
      catch (error) {
        if (!failed || (error instanceof UsageAccountingError && !(firstError instanceof UsageAccountingError))) {
          firstError = error;
        }
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROVIDER_CONCURRENCY, items.length) }, worker));
  if (failed) throw firstError;
}

/**
 * 街角展示基准（px）：内置猫 idle 内容高 28px × 3 倍。自定义精灵帧画布 64px、
 * 内容高随种子浮动（第 10 轮实测 52px），按此基准决议 displayScale 让每只
 * 宠物在街角的视觉高度落在基准带内、同时保留自然体型差。
 */
const PET_STREET_BASELINE_PX = 84;

/** 四宫格批次：9 状态 → 3 张 2x2（每张 3 状态 + 空格） */
const QUAD_BATCHES: readonly (readonly PetStateId[])[] = [
  ['idle', 'walk', 'joy'],
  ['eat', 'sleep', 'think'],
  ['celebrate', 'grumpy', 'welcome'],
];

/** 在飞状态（tick 只推进这些；awaiting/done/failed 是停驻态）。
 * 提交侧（petgen-service）用同一份集合拒绝同租户并发任务——nextDueTask
 * 只推进「租户恰 1 个在飞」的任务，放行并发提交会永久互卡 */
export const IN_FLIGHT: readonly PetGenTask['status'][] = [
  'spec_submitted',
  'concept_generating',
  'generating_states',
  'qc',
];

/** 错误消息（Node errno 对象也兼容） */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 任务工作目录：tenants/<sub>/pet-assets/tasks/<taskId>/ */
function taskDirOf(dataDir: string, tenantId: string, taskId: string): string {
  return join(tenantDataDir(dataDir, tenantId), 'pet-assets', 'tasks', taskId);
}

export class PetGenProcessor {
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 已告警过的互卡租户（同租户 ≥2 在飞 = 队列永久互卡，只报一次防刷屏） */
  private alertedStuck = new Set<string>();
  /** 视觉质检连续 infra 异常轮数（taskId → 次数；干净轮/失败即清） */
  private qcInfraFails = new Map<string, number>();

  constructor(private readonly deps: PetGenProcessorDeps) {}

  /** 启动间隔循环（index.ts；intervalMs ≤ 0 = 关闭，与调度器同开关语义） */
  start(intervalMs: number): void {
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** 推进一个待办任务；无任务返回 false（可测） */
  async tick(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const task = await this.nextDueTask();
      if (!task) return false;
      await this.advance(task);
      return true;
    } catch (error) {
      // tick 异常必须可见（否则任务卡死在在飞状态、队列静默停摆）
      console.error(`[petgen] tick 异常：${messageOf(error)}`);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** 下一个可推进任务：租户已有在飞任务则跳过（租户隔离） */
  private async nextDueTask(): Promise<PetGenTask | undefined> {
    const db = this.deps.db;
    const inflight = await db
      .select()
      .from(petGenTasks)
      .where(inArray(petGenTasks.status, IN_FLIGHT))
      .orderBy(asc(petGenTasks.createdAt))
      .all();
    const counts = new Map<string, number>();
    for (const t of inflight) {
      counts.set(t.tenantId, (counts.get(t.tenantId) ?? 0) + 1);
    }
    // 互卡检测（提交侧已串行化，此为历史脏数据的发现通道）：同租户 ≥2 在飞
    // 时谁都不可推进且提交侧 409——除手工改库外无自愈路径，必须响亮报错
    for (const [tenantId, count] of counts) {
      if (count >= 2 && !this.alertedStuck.has(tenantId)) {
        this.alertedStuck.add(tenantId);
        console.error(
          `[petgen] 租户 ${tenantId} 有 ${count} 个在飞任务（互卡，队列停摆）——` +
            '请人工核查 pet_gen_tasks 并清理多余在飞行',
        );
      }
    }
    return inflight.find((t) => (counts.get(t.tenantId) ?? 0) === 1);
  }

  private async patch(
    id: string,
    patch: Partial<PetGenTask> & { updatedAt: number },
  ): Promise<void> {
    await this.deps.db
      .update(petGenTasks)
      .set(patch)
      .where(eq(petGenTasks.id, id))
      .run();
  }

  private async fail(task: PetGenTask, message: string): Promise<void> {
    this.qcInfraFails.delete(task.id);
    await this.patch(task.id, { status: 'failed', error: message, updatedAt: this.now() });
  }

  private taskDir(task: PetGenTask): string {
    return taskDirOf(this.deps.dataDir, task.tenantId, task.id);
  }

  /** 租户归属由任务绑定，模型由 provider 的实际请求捕获。 */
  private usageCallback(task: PetGenTask, kind: 'image' | 'vision_qc'): RecordProviderUsage {
    return async (model) => {
      const recorder = this.deps.usage;
      if (!recorder) return;
      if (kind === 'image') await recorder.recordImage(task.tenantId, model);
      else await recorder.recordVision(task.tenantId, model);
    };
  }

  private specFromTask(task: PetGenTask): PetSpec {
    const stylePreset = (task.stylePreset ?? DEFAULT_PET_PRESET) as PetPresetId;
    if (!(stylePreset in PET_STYLE_PRESETS)) {
      throw new Error(`未知风格预设: ${task.stylePreset}（注册表 PET_STYLE_PRESETS 中不存在）`);
    }
    return {
      specText: task.specText,
      options: task.options ? (JSON.parse(task.options) as PetSpec['options']) : undefined,
      stylePreset,
    };
  }

  /** 是否领养精灵图路径（sheet/strip 阶梯；决定自动确认/素材形状/QC 口径） */
  private isSheetTask(task: PetGenTask): boolean {
    return task.strategy === 'sheet' || task.strategy === 'strip';
  }

  /** 该任务的全量动画集（精灵图 = PET_SHEET_ANIMS 子集；改造屋 = 9 状态） */
  private animsOfTask(task: PetGenTask): PetStateId[] {
    return this.isSheetTask(task) ? [...PET_SHEET_STATE_IDS] : [...PET_STATE_IDS];
  }

  /** 待重生成状态：QC 失败的 pendingStates；空 = 全量（按任务路径取全集） */
  private pendingStatesOf(task: PetGenTask): PetStateId[] {
    const all = this.animsOfTask(task);
    if (!task.pendingStates) return all;
    const parsed = JSON.parse(task.pendingStates) as string[];
    const valid = parsed.filter((s): s is PetStateId =>
      (all as string[]).includes(s),
    );
    return valid.length > 0 ? valid : all;
  }

  private async advance(task: PetGenTask): Promise<void> {
    try { await assertUsageHealthy(tenantDataDir(this.deps.dataDir, task.tenantId)); }
    catch (error) {
      await this.fail(task, `用量记账异常，任务已停止：${messageOf(error)}`);
      return;
    }
    switch (task.status) {
      case 'spec_submitted':
      case 'concept_generating':
        await this.advanceConcept(task);
        return;
      case 'generating_states':
        await this.advanceGenerating(task);
        return;
      case 'qc':
        await this.advanceQc(task);
        return;
      default:
        // awaiting_confirmation（用户锚点）/ done / failed：停驻
        return;
    }
  }

  // 概念图阶段

  /** 领养上传参考图（saveAdoptReference 落定；无上传 = 文件不存在） */
  private adoptReferencePath(tenantId: string): string {
    return join(tenantDataDir(this.deps.dataDir, tenantId), 'pet-assets', 'adopt-reference.jpg');
  }

  private async advanceConcept(task: PetGenTask): Promise<void> {
    const taskDir = this.taskDir(task);
    await mkdir(taskDir, { recursive: true });
    // 领养精灵图 + 已上传参考图：跳过概念图，上传图即角色锚点（领养不阻塞）
    if (this.isSheetTask(task)) {
      const adoptRef = this.adoptReferencePath(task.tenantId);
      try {
        await access(adoptRef);
      } catch {
        await this.advanceConceptForSheet(task, taskDir);
        return;
      }
      const refPath = join(taskDir, 'reference.jpg');
      await copyFile(adoptRef, refPath);
      await this.patch(task.id, { status: 'generating_states', updatedAt: this.now() });
      return;
    }
    await this.advanceConceptForClassic(task, taskDir);
  }

  /** 概念图生成公共体（spec → 出图 → 归一 → concept.png）；失败抛错由调用方定论 */
  private async generateConcept(task: PetGenTask, taskDir: string): Promise<void> {
    const spec = this.specFromTask(task);
    const preset = PET_STYLE_PRESETS[spec.stylePreset ?? DEFAULT_PET_PRESET];
    const rawPath = join(taskDir, 'concept-raw.png');
    await this.deps.imageGen.generate({
      kind: 'concept',
      prompt: buildConceptPrompt(spec, preset),
      outPath: rawPath,
      onUsage: this.usageCallback(task, 'image'),
    });
    await this.deps.splitter.normalizeConcept(
      rawPath,
      join(taskDir, 'concept.png'),
      this.deps.config.conceptFrame,
    );
  }

  /** 精灵图路径概念图（无上传时）：出图即锁角色，自动确认直落 generating_states */
  private async advanceConceptForSheet(task: PetGenTask, taskDir: string): Promise<void> {
    await this.patch(task.id, { status: 'concept_generating', updatedAt: this.now() });
    try {
      await this.generateConcept(task, taskDir);
      await this.patch(task.id, {
        status: 'generating_states',
        conceptAttempts: task.conceptAttempts + 1,
        updatedAt: this.now(),
      });
    } catch (error) {
      await this.fail(task, `概念图生成失败：${messageOf(error)}`);
    }
  }

  private async advanceConceptForClassic(task: PetGenTask, taskDir: string): Promise<void> {
    await this.patch(task.id, { status: 'concept_generating', updatedAt: this.now() });
    try {
      await this.generateConcept(task, taskDir);
      // conceptPath 存相对租户目录的路径（route 拼回绝对路径服务图片）
      const relative = `pet-assets/tasks/${task.id}/concept.png`;
      await this.patch(task.id, {
        status: 'awaiting_confirmation',
        conceptPath: relative,
        conceptAttempts: task.conceptAttempts + 1,
        updatedAt: this.now(),
      });
    } catch (error) {
      await this.fail(task, `概念图生成失败：${messageOf(error)}`);
    }
  }

  // 多状态生成阶段（策略阶梯）

  /** 待生成状态的批次分组（quad 按四宫格批次；nine 整张 3x3；per 单状态） */
  private batchesFor(strategy: GenStrategy, pending: PetStateId[]): PetStateId[][] {
    if (strategy === 'per') return pending.map((s) => [s]);
    if (strategy === 'quad') {
      // 单张 2x2 = 3 状态：只重生成含失败状态的批次（spike 失败粒度）
      return QUAD_BATCHES.filter((b) => b.some((s) => pending.includes(s))).map((b) => [...b]);
    }
    // nine：3x3 网格必须 9 格齐整（重试也整张重生成）
    return [[...PET_STATE_IDS]];
  }

  /** Only states whose image bytes were replaced need semantic QC again. */
  private regeneratedStates(task: PetGenTask, pending: PetStateId[]): PetStateId[] {
    if (task.strategy === 'sheet') return this.animsOfTask(task);
    if (task.strategy === 'strip' || task.strategy === 'per') return pending;
    return [...new Set(this.batchesFor(task.strategy, pending).flat())];
  }

  /** 参考图（概念图 → 白底 JPEG；同概念图只压平一次；领养上传参考在概念阶段已就位） */
  private async ensureReference(taskDir: string, task: PetGenTask): Promise<string> {
    const refPath = join(taskDir, 'reference.jpg');
    try {
      await access(refPath);
      return refPath;
    } catch {
      // 不存在 → 生成
    }
    return this.deps.splitter.flattenReference(
      join(taskDir, 'concept.png'),
      refPath,
      this.deps.config.referenceFrame,
    );
  }

  private async runStrategy(
    task: PetGenTask,
    strategy: GenStrategy,
    pending: PetStateId[],
  ): Promise<void> {
    if (strategy === 'sheet') {
      await this.runSheetStrategy(task);
      return;
    }
    if (strategy === 'strip') {
      await this.runStripStrategy(task, pending);
      return;
    }
    await this.runClassicStrategy(task, strategy, pending);
  }

  /** 精灵图主策略：单张 n×n 全动作全帧（一致性单图化；空格 = 模型漏格 → 策略失败） */
  private async runSheetStrategy(task: PetGenTask): Promise<void> {
    const spec = this.specFromTask(task);
    const preset = PET_STYLE_PRESETS[spec.stylePreset ?? DEFAULT_PET_PRESET];
    const taskDir = this.taskDir(task);
    const reference = await this.ensureReference(taskDir, task);
    const statesDir = join(taskDir, 'states');
    await mkdir(statesDir, { recursive: true });
    const gridPath = join(taskDir, 'grids', 'sheet.png');
    await mkdir(join(taskDir, 'grids'), { recursive: true });
    await this.deps.imageGen.generate({
      kind: 'sheet',
      prompt: buildSheetPrompt(spec, preset, PET_SHEET_ANIMS, PET_SHEET_GRID),
      outPath: gridPath,
      reference,
      onUsage: this.usageCallback(task, 'image'),
    });
    const result = await this.deps.splitter.splitSheet(gridPath, {
      rows: PET_SHEET_GRID,
      cols: PET_SHEET_GRID,
      anims: PET_SHEET_ANIMS,
      frame: PET_SHEET_FRAME,
      outDir: statesDir,
    });
    // 漏格 = 布局不顺从 → 策略失败（计数重试/降级 strip），空帧不能流入 QC
    if (result.emptyCells > 0) {
      throw new Error(`精灵图模型漏格 ${result.emptyCells} 格（布局不顺从）`);
    }
  }

  /** strip 降级：逐动画 1×N 行条重生成（行内一致性仍在单图内保证） */
  private async runStripStrategy(task: PetGenTask, pending: PetStateId[]): Promise<void> {
    const spec = this.specFromTask(task);
    const preset = PET_STYLE_PRESETS[spec.stylePreset ?? DEFAULT_PET_PRESET];
    const taskDir = this.taskDir(task);
    const reference = await this.ensureReference(taskDir, task);
    const statesDir = join(taskDir, 'states');
    await mkdir(statesDir, { recursive: true });
    for (const anim of pending) {
      const declared = PET_SHEET_ANIMS.find((a) => a.state === anim);
      if (!declared) {
        throw new Error(`动画 ${anim} 不在精灵图动画集（PET_SHEET_ANIMS）中`);
      }
      const stripPath = join(taskDir, 'grids', `strip-${anim}.png`);
      await mkdir(join(taskDir, 'grids'), { recursive: true });
      await this.deps.imageGen.generate({
        kind: 'sheet',
        prompt: buildStripPrompt(
          spec,
          preset,
          PET_STATES[anim].label,
          declared.frames,
          sheetRowOf(anim).hint,
        ),
        outPath: stripPath,
        reference,
        onUsage: this.usageCallback(task, 'image'),
      });
      const result = await this.deps.splitter.splitSheet(stripPath, {
        rows: 1,
        cols: declared.frames,
        anims: [declared],
        frame: PET_SHEET_FRAME,
        outDir: statesDir,
      });
      if (result.emptyCells > 0) {
        throw new Error(`strip 重生成 ${anim} 漏格（布局不顺从）`);
      }
    }
    // splitSheet 每次只写本次动画的总条，逐动画调用互相覆盖——
    // 全部重生成完毕后按全动画次序重建 sprite.png（漏建 = 播放器帧表错位）
    await this.deps.splitter.joinSprite(statesDir, PET_SHEET_ANIMS, PET_SHEET_FRAME);
  }

  private async runClassicStrategy(
    task: PetGenTask,
    strategy: GenStrategy,
    pending: PetStateId[],
  ): Promise<void> {
    const spec = this.specFromTask(task);
    const preset = PET_STYLE_PRESETS[spec.stylePreset ?? DEFAULT_PET_PRESET];
    const taskDir = this.taskDir(task);
    const reference = await this.ensureReference(taskDir, task);
    const statesDir = join(taskDir, 'states');
    await mkdir(statesDir, { recursive: true });
    await forEachProviderBounded(this.batchesFor(strategy, pending), async (batch) => {
      const cols = strategy === 'quad' ? 2 : strategy === 'nine' ? 3 : 1;
      const layout = strategy === 'quad' ? '2x2' : strategy === 'nine' ? '3x3' : '1x1';
      const gridPath = join(taskDir, 'grids', `g-${strategy}-${batch.join('-')}.png`);
      await mkdir(join(taskDir, 'grids'), { recursive: true });
      await this.deps.imageGen.generate({
        kind: 'grid',
        prompt: buildGridPrompt(spec, preset, batch, layout),
        outPath: gridPath,
        reference,
        onUsage: this.usageCallback(task, 'image'),
      });
      const { files, emptyCells } = await this.deps.splitter.splitGrid(gridPath, batch, {
        cols,
        outDir: statesDir,
      });
      // 2x2 三状态布局下模型画满 4 格 = 空位指令不顺从 → 本策略失败（spike §4 回退条件）
      if (strategy === 'quad' && batch.length === 3 && emptyCells === 0) {
        throw new Error('模型未留空格（空位指令不顺从），按 spike 结论放弃 2x2 布局');
      }
      // 落盘检查：切分返回的每个文件必须真实存在（禁兜底）
      for (const file of Object.values(files)) {
        try {
          await access(file);
        } catch {
          throw new Error(`切分产物缺失: ${file}`);
        }
      }
    });
  }

  private async advanceGenerating(task: PetGenTask): Promise<void> {
    const now = this.now();
    try {
      const pending = this.pendingStatesOf(task);
      await this.runStrategy(task, task.strategy, pending);
      // 全部状态就绪 → 进入质检
      await this.patch(task.id, {
        status: 'qc',
        // Keep the exact write set across ticks/restarts. A previous pass is
        // reusable only when its image was not regenerated.
        pendingStates: JSON.stringify(this.regeneratedStates(task, pending)),
        batchRetries: 0,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof UsageAccountingError) {
        await this.fail(task, `用量记账异常，任务已停止：${messageOf(error)}`);
        return;
      }
      // 单次批次失败：升级策略或计数重试（状态保持 generating_states，下 tick 重试）；
      // 阶梯（按任务路径：sheet→strip 或 quad→nine→per）已到顶且次数超限 → 整体失败
      const ladder = strategyLadder(task.strategy);
      const strategyIdx = ladder.indexOf(task.strategy);
      const batchRetries = task.batchRetries + 1;
      if (batchRetries >= this.deps.config.maxBatchRetries) {
        if (strategyIdx < ladder.length - 1) {
          await this.patch(task.id, {
            strategy: ladder[strategyIdx + 1],
            batchRetries: 0,
            updatedAt: now,
          });
        } else {
          await this.fail(
            task,
            `多状态生成多次失败（${messageOf(error)}）——请调整 spec 后重新生成`,
          );
        }
      } else {
        await this.patch(task.id, { batchRetries, updatedAt: now });
      }
    }
  }

  // 质检阶段（两层：结构脚本 + 语义豆包视觉）

  /**
   * 视觉质检 infra 异常收尾：保持 qc 态、下 tick 整轮重试——不消耗
   * qcRetries、不触发生图重生成（infra 故障与图无关，重生成只会白烧生图
   * 费）；连续超限才整体失败，且带真实异常文案（不误导用户「调整 spec」）。
   * 计数在内存：进程重启归零可接受（连续故障语义不变）。
   */
  private async handleQcInfraError(task: PetGenTask, error: unknown): Promise<void> {
    if (error instanceof UsageAccountingError) {
      await this.fail(task, `用量记账异常，任务已停止：${messageOf(error)}`);
      return;
    }
    const fails = (this.qcInfraFails.get(task.id) ?? 0) + 1;
    if (fails >= this.deps.config.maxQcInfraRetries) {
      await this.fail(task, `视觉质检连续异常（${messageOf(error)}）——质检服务暂不可用，请稍后重试`);
      return;
    }
    this.qcInfraFails.set(task.id, fails);
    console.warn(
      `[petgen] 视觉质检异常（task ${task.id}，第 ${fails}/${this.deps.config.maxQcInfraRetries} 轮，保持 qc 态重试）：${messageOf(error)}`,
    );
  }

  private async advanceQc(task: PetGenTask): Promise<void> {
    const now = this.now();
    const taskDir = this.taskDir(task);
    const statesDir = join(taskDir, 'states');
    const spec = this.specFromTask(task);
    if (this.isSheetTask(task)) {
      await this.advanceSheetQc(task, { taskDir, statesDir, spec, now });
      return;
    }
    try {
      const structural = await this.deps.structureQc.inspect(statesDir, [...PET_STATE_IDS]);
      const previous = task.qcResult ? parseStoredQcResult(task.qcResult) : null;
      const changed = new Set(task.pendingStates ? this.pendingStatesOf(task) : PET_STATE_IDS);
      const semantic: Record<PetStateId, StateQcResult> = {} as Record<PetStateId, StateQcResult>;
      try {
        await forEachProviderBounded(PET_STATE_IDS, async (state) => {
          const s = structural[state];
          if (!s.pass) {
            semantic[state] = { pass: false, issues: [`结构质检：${s.issues.join('；')}`] };
            return;
          }
          if (!changed.has(state) && previous?.[state]?.pass === true) {
            semantic[state] = previous[state];
            return;
          }
          semantic[state] = await this.deps.visionQc.inspect({
            referencePath: join(taskDir, 'concept.png'),
            statePath: join(statesDir, `${state}.png`),
            state,
            spec,
            onUsage: this.usageCallback(task, 'vision_qc'),
          });
        });
      } catch (error) {
        // Infra failure invalidates this QC round; all in-flight usage is settled first.
        await this.handleQcInfraError(task, error);
        return;
      }
      this.qcInfraFails.delete(task.id);
      const failed = PET_STATE_IDS.filter(
        (s) => !structural[s].pass || !semantic[s].pass,
      );
      await this.patch(task.id, { qcResult: JSON.stringify(semantic), updatedAt: now });
      if (failed.length === 0) {
        await this.finalize(task);
        return;
      }
      await this.handleQcFailure(task, failed, semantic, now);
    } catch (error) {
      await this.fail(task, `质检执行失败：${messageOf(error)}`);
    }
  }

  /** 精灵图 QC：64px 横排帧条的结构质检（--frame/--frames）+ 帧间连贯性语义质检 */
  private async advanceSheetQc(
    task: PetGenTask,
    ctx: { taskDir: string; statesDir: string; spec: PetSpec; now: number },
  ): Promise<void> {
    const { taskDir, statesDir, spec, now } = ctx;
    try {
      const anims = this.animsOfTask(task);
      const frames = Object.fromEntries(
        PET_SHEET_ANIMS.map((a) => [a.state, a.frames]),
      ) as Partial<Record<PetStateId, number>>;
      const structural = await this.deps.structureQc.inspect(statesDir, anims, {
        frame: PET_SHEET_FRAME,
        frames,
      });
      const previous = task.qcResult ? parseStoredQcResult(task.qcResult) : null;
      const changed = new Set(task.pendingStates ? this.pendingStatesOf(task) : anims);
      // 语义锚点：上传参考图（无 concept 的领养路径）或概念图
      let referencePath = join(taskDir, 'concept.png');
      try {
        await access(referencePath);
      } catch {
        referencePath = join(taskDir, 'reference.jpg');
      }
      // 送审放大：64px 帧条直接送审，视觉模型会漏检/误判（基准实测 ×4 后与人眼一致）
      const qcDir = join(taskDir, 'qc-upscale');
      await mkdir(qcDir, { recursive: true });
      const semantic: Record<PetStateId, StateQcResult> = {} as Record<PetStateId, StateQcResult>;
      let infraError: unknown = null;
      for (const anim of anims) {
        const s = structural[anim];
        if (!s.pass) {
          semantic[anim] = { pass: false, issues: [`结构质检：${s.issues.join('；')}`] };
          continue;
        }
        if (!changed.has(anim) && previous?.[anim]?.pass === true) {
          semantic[anim] = previous[anim];
          continue;
        }
        const upscaleFactor = Math.max(1, Math.round(256 / PET_SHEET_FRAME));
        const statePath = await this.deps.splitter.upscaleForQc(
          join(statesDir, `${anim}.png`),
          qcDir,
          upscaleFactor,
        );
        try {
          const r = await this.deps.visionQc.inspect({
            referencePath,
            statePath,
            state: anim,
            spec,
            frames: frames[anim],
            onUsage: this.usageCallback(task, 'vision_qc'),
          });
          semantic[anim] = r;
        } catch (error) {
          infraError = error;
          break; // 供应商级故障时后续调用大概率同挂，剩余调用留到下轮
        }
      }
      if (infraError !== null) {
        await this.handleQcInfraError(task, infraError);
        return;
      }
      this.qcInfraFails.delete(task.id);
      const failed = anims.filter((s) => !structural[s].pass || !semantic[s].pass);
      await this.patch(task.id, { qcResult: JSON.stringify(semantic), updatedAt: now });
      if (failed.length === 0) {
        await this.finalize(task);
        return;
      }
      await this.handleQcFailure(task, failed, semantic, now);
    } catch (error) {
      await this.fail(task, `质检执行失败：${messageOf(error)}`);
    }
  }

  /** QC 失败收尾：只重生成失败态；批次/切分故障仍按策略阶梯升级。 */
  private async handleQcFailure(
    task: PetGenTask,
    failed: PetStateId[],
    semantic: Record<PetStateId, StateQcResult>,
    now: number,
  ): Promise<void> {
    const qcRetries = task.qcRetries + 1;
    if (qcRetries >= this.deps.config.maxQcRetries) {
      const detail = failed
        .map((s) => `${PET_STATES[s].label}(${s}): ${semantic[s].issues.join('；')}`)
        .join('; ');
      await this.patch(task.id, {
        status: 'failed',
        qcRetries,
        error: `质检多次不合格（${detail}）——请调整 spec 后重新生成`,
        updatedAt: now,
      });
      return;
    }
    // 内容不合格与布局/切分故障不同。经典九宫格会重画已过的八态，
    // 违背 ADR-0001 单状态失败重试；逐态参考同一概念图并保留逐态 QC。
    const ladder = strategyLadder(task.strategy);
    const strategyIdx = ladder.indexOf(task.strategy);
    const nextStrategy =
      this.isSheetTask(task) ? (ladder[strategyIdx + 1] ?? task.strategy) : 'per';
    await this.patch(task.id, {
      status: 'generating_states',
      strategy: nextStrategy,
      qcRetries,
      pendingStates: JSON.stringify(failed),
      batchRetries: 0,
      updatedAt: now,
    });
  }

  // 交付：素材落租户 pet-assets 目录

  private async finalize(task: PetGenTask): Promise<void> {
    const now = this.now();
    const assetsDir = join(tenantDataDir(this.deps.dataDir, task.tenantId), 'pet-assets');
    const taskDir = this.taskDir(task);
    const statesDir = join(taskDir, 'states');
    await mkdir(assetsDir, { recursive: true });
    const spec = this.specFromTask(task);
    let manifest: Record<string, unknown>;
    if (this.isSheetTask(task)) {
      manifest = await this.finalizeSheet(task, { taskDir, assetsDir, statesDir, spec, now });
    } else {
      await copyFile(join(taskDir, 'concept.png'), join(assetsDir, 'concept.png'));
      for (const state of PET_STATE_IDS) {
        await copyFile(join(statesDir, `${state}.png`), join(assetsDir, `${state}.png`));
      }
      // manifest 契约（对齐 PetStateSpec；自定义 IP = 单帧静态 + 播放器微动画）
      manifest = {
        version: 1,
        generatedAt: new Date(now).toISOString(),
        spec,
        concept: 'concept.png',
        states: Object.fromEntries(
          PET_STATE_IDS.map((s) => [s, { ...PET_STATES[s], file: s, frames: 1 }]),
        ),
      };
    }
    // 原子写：temp + rename（防半写 manifest 被消费方读到）
    const tmp = join(assetsDir, 'manifest.json.tmp');
    await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
    await rename(tmp, join(assetsDir, 'manifest.json'));
    await this.patch(task.id, {
      status: 'done',
      completedAt: now,
      error: null,
      updatedAt: now,
    });
    await this.publishAssetsReady(task);
  }

  /**
   * 精灵图交付：每动画帧条 + sprite.png 总条拷入 pet-assets；manifest 带
   * sprite 块（frames.json 同构，web 播放器直接建 SpriteContract 播放）。
   * 领养上传路径无 concept.png（concept 可选）；帧数以生成期实报（PET_SHEET_ANIMS
   * 声明值）为准——strip 重生成不改变帧数。
   */
  private async finalizeSheet(
    task: PetGenTask,
    ctx: { taskDir: string; assetsDir: string; statesDir: string; spec: PetSpec; now: number },
  ): Promise<Record<string, unknown>> {
    const { taskDir, assetsDir, statesDir, spec, now } = ctx;
    // concept.png 仅在「无上传参考图」路径产出——存在才拷（领养上传路径无概念图）
    const conceptSrc = join(taskDir, 'concept.png');
    const hasConcept = await access(conceptSrc).then(
      () => true,
      () => false,
    );
    if (hasConcept) {
      await copyFile(conceptSrc, join(assetsDir, 'concept.png'));
    }
    const animations: Record<string, { from: number; frames: number; duration: number; loop: boolean }> = {};
    const states: Record<string, unknown> = {};
    let cursor = 0;
    for (const a of PET_SHEET_ANIMS) {
      await copyFile(join(statesDir, `${a.state}.png`), join(assetsDir, `${a.state}.png`));
      animations[a.state] = { from: cursor, frames: a.frames, duration: a.duration, loop: true };
      states[a.state] = {
        file: a.state,
        frames: a.frames,
        dur: a.duration,
        label: PET_STATES[a.state].label,
      };
      cursor += a.frames;
    }
    await copyFile(join(statesDir, 'sprite.png'), join(assetsDir, 'sprite.png'));
    // 总条宽度断言（PNG IHDR 大端 width）：防「strip 重生成后总条被单动画覆盖」
    // 这类静默截断流入消费端——manifest 声明 16 帧而文件只有 2 帧 = 播放错位
    const ihdr = await readFile(join(assetsDir, 'sprite.png')).then((b) => b.subarray(0, 24));
    const width = ihdr.readUInt32BE(16);
    if (width !== cursor * PET_SHEET_FRAME) {
      throw new Error(
        `sprite.png 宽 ${width}px != 期望 ${cursor * PET_SHEET_FRAME}px（总条与动画帧表不符）`,
      );
    }
    // 街角展示缩放：内置猫基准 84px（idle 内容高 28px × 3）。帧画布固定 64px，
    // 角色占格因种子/物种而异（第 10 轮实测 52px，直接 ×3 比内置猫高近一倍）——
    // 按实测内容高落回基准带；整数倍率是 steps() 帧步进的像素对齐硬约束。
    // 夹在 [2,3]：每只宠物保留自然体型差，但既不过度缩小也不过度放大。
    const contentHeight = await this.measureIdleContentHeight(statesDir);
    const displayScale = contentHeight
      ? Math.min(3, Math.max(2, Math.round(PET_STREET_BASELINE_PX / contentHeight)))
      : undefined;
    return {
      version: 2,
      generatedAt: new Date(now).toISOString(),
      spec,
      ...(hasConcept ? { concept: 'concept.png' } : {}),
      states,
      sprite: {
        image: 'sprite.png',
        frame: { w: PET_SHEET_FRAME, h: PET_SHEET_FRAME, groundRow: PET_SHEET_FRAME - 1 },
        animations,
        ...(contentHeight !== undefined ? { contentHeight, displayScale } : {}),
      },
    };
  }

  /** sheet-meta.json 里 idle 各帧内容高取最大（切分脚本测量）；旧版脚本无 idle 条目 → undefined */
  private async measureIdleContentHeight(statesDir: string): Promise<number | undefined> {
    const metaPath = join(statesDir, 'sheet-meta.json');
    if (!(await access(metaPath).then(() => true, () => false))) return undefined;
    // 形状守卫：脚手架产物也按契约验——坏形状是脚本/处理器版本漂移，宁可响炸
    // 也不静默吞成「无测量」（禁兜底；与 parseSheetReport 同款手动校验）
    const parsed: unknown = JSON.parse(await readFile(metaPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('anims' in parsed)) {
      throw new Error('sheet-meta.json 缺 anims 字段（pet-sheet.py 版本漂移）');
    }
    const anims = (parsed as { anims: Record<string, unknown> }).anims;
    const idle = (anims as Record<string, { contentHeights?: unknown }>).idle;
    if (!idle) return undefined; // 旧版脚本无测量，字段可选
    if (!Array.isArray(idle.contentHeights)) {
      throw new Error('sheet-meta.json idle.contentHeights 非数组（pet-sheet.py 版本漂移）');
    }
    const heights = (idle.contentHeights as unknown[]).filter(
      (h): h is number => typeof h === 'number' && h > 0,
    );
    return heights.length > 0 ? Math.max(...heights) : undefined;
  }

  /** pet_assets_ready 事件（web 拉 manifest 换形象）；无宠物行/未注入 bus → 不发。
   * 通知失败不回滚任务：素材已交付、web 另有刷新拉取兜底，DB 抖动不该把
   * 已 done 的任务改判 failed（事件是锦上添花，不是交付链一环） */
  private async publishAssetsReady(task: PetGenTask): Promise<void> {
    if (!this.deps.bus) return;
    try {
      const pet = await findPetByTenant(this.deps.db, task.tenantId);
      if (!pet) return;
      this.deps.bus.publish(task.tenantId, {
        type: 'pet_assets_ready',
        tenantId: task.tenantId,
        petId: pet.id,
        at: this.now(),
        detail: `task ${task.id}`,
      });
    } catch (error) {
      console.error(`[petgen] pet_assets_ready 事件发送失败（task ${task.id}）：`, error);
    }
  }
}

export { taskDirOf };
