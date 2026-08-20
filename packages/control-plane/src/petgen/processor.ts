/**
 * 宠物 IP 生成任务处理器（#94）—— 异步队列状态机
 *
 * tick() 每间隔推进一个待办任务（单 tick 单任务 + 租户隔离：同租户已有
 * 在飞任务则跳过，天然防并发写租户目录）：
 *
 *   spec_submitted → concept_generating → awaiting_confirmation →
 *   generating_states → qc → done | failed
 *
 * - awaiting_confirmation 是用户锚点（ADR-0001 参考图锁角色）：确认 →
 *   generating_states；不满意改 spec → restart（回 spec_submitted 重出概念图）。
 * - 策略阶梯（spike 结论）：quad（四宫格 2x2×3 主路径）→ nine（九宫格）→
 *   per（逐状态）。批次失败（切分缺文件/模型画满 2x2 空格）连续
 *   maxBatchRetries 次 → 升级策略；语义质检失败 → 单状态重试 + 升级策略，
 *   maxQcRetries 轮后仍有失败状态 → 整体 failed（用户改 spec 重来，不占配额）。
 * - 素材落 data/tenants/<sub>/pet-assets/（manifest + 状态 PNG + 概念图），
 *   manifest 契约对齐 web/lib/pet-sprite.ts PetStateSpec（自定义 IP 单帧）。
 */

import { access, copyFile, mkdir, rename, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_PET_PRESET,
  PET_STATES,
  PET_STATE_IDS,
  PET_STYLE_PRESETS,
  type PetPresetId,
  type PetStateId,
} from '@cyber-stray/shared/pet';
import { petGenTasks, type PetGenTask } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { buildConceptPrompt, buildGridPrompt } from './prompt.js';
import {
  type GenStrategy,
  type PetGenProcessorDeps,
  type PetSpec,
  type StateQcResult,
} from './types.js';

/** 策略阶梯（spike 结论：四宫格主路径，九宫格/逐状态回退） */
const STRATEGY_ORDER: readonly GenStrategy[] = ['quad', 'nine', 'per'];

/** 四宫格批次：9 状态 → 3 张 2x2（每张 3 状态 + 空格） */
const QUAD_BATCHES: readonly (readonly PetStateId[])[] = [
  ['idle', 'walk', 'joy'],
  ['eat', 'sleep', 'think'],
  ['celebrate', 'grumpy', 'welcome'],
];

/** 在飞状态（tick 只推进这些；awaiting/done/failed 是停驻态） */
const IN_FLIGHT: readonly PetGenTask['status'][] = [
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
    await this.patch(task.id, { status: 'failed', error: message, updatedAt: this.now() });
  }

  private taskDir(task: PetGenTask): string {
    return taskDirOf(this.deps.dataDir, task.tenantId, task.id);
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

  /** 待重生成状态：QC 失败的 pendingStates；空 = 全量 9 状态 */
  private pendingStatesOf(task: PetGenTask): PetStateId[] {
    if (!task.pendingStates) return [...PET_STATE_IDS];
    const parsed = JSON.parse(task.pendingStates) as string[];
    const valid = parsed.filter((s): s is PetStateId =>
      (PET_STATE_IDS as readonly string[]).includes(s),
    );
    return valid.length > 0 ? valid : [...PET_STATE_IDS];
  }

  private async advance(task: PetGenTask): Promise<void> {
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

  // ─── 概念图阶段 ──────────────────────────────────────────────────────

  private async advanceConcept(task: PetGenTask): Promise<void> {
    const taskDir = this.taskDir(task);
    await this.patch(task.id, { status: 'concept_generating', updatedAt: this.now() });
    try {
      const spec = this.specFromTask(task);
      const preset = PET_STYLE_PRESETS[spec.stylePreset ?? DEFAULT_PET_PRESET];
      await mkdir(taskDir, { recursive: true });
      const rawPath = join(taskDir, 'concept-raw.png');
      await this.deps.imageGen.generate({
        kind: 'concept',
        prompt: buildConceptPrompt(spec, preset),
        outPath: rawPath,
      });
      const conceptPath = await this.deps.splitter.normalizeConcept(
        rawPath,
        join(taskDir, 'concept.png'),
        this.deps.config.conceptFrame,
      );
      // conceptPath 存相对租户目录的路径（route 拼回绝对路径服务图片）
      const relative = `pet-assets/tasks/${task.id}/${basename(conceptPath)}`;
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

  // ─── 多状态生成阶段（策略阶梯） ─────────────────────────────────────

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

  /** 参考图（概念图 → 白底 JPEG；同概念图只压平一次） */
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
    const spec = this.specFromTask(task);
    const preset = PET_STYLE_PRESETS[spec.stylePreset ?? DEFAULT_PET_PRESET];
    const taskDir = this.taskDir(task);
    const reference = await this.ensureReference(taskDir, task);
    const statesDir = join(taskDir, 'states');
    await mkdir(statesDir, { recursive: true });
    for (const batch of this.batchesFor(strategy, pending)) {
      const cols = strategy === 'quad' ? 2 : strategy === 'nine' ? 3 : 1;
      const layout = strategy === 'quad' ? '2x2' : strategy === 'nine' ? '3x3' : '1x1';
      const gridPath = join(taskDir, 'grids', `g-${strategy}-${batch.join('-')}.png`);
      await mkdir(join(taskDir, 'grids'), { recursive: true });
      await this.deps.imageGen.generate({
        kind: 'grid',
        prompt: buildGridPrompt(spec, preset, batch, layout),
        outPath: gridPath,
        reference,
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
    }
  }

  private async advanceGenerating(task: PetGenTask): Promise<void> {
    const now = this.now();
    try {
      const pending = this.pendingStatesOf(task);
      await this.runStrategy(task, task.strategy, pending);
      // 全部状态就绪 → 进入质检
      await this.patch(task.id, {
        status: 'qc',
        pendingStates: null,
        batchRetries: 0,
        updatedAt: now,
      });
    } catch (error) {
      // 单次批次失败：升级策略或计数重试（状态保持 generating_states，下 tick 重试）；
      // 阶梯已到顶且次数超限 → 整体失败（改 spec 重来）
      const strategyIdx = STRATEGY_ORDER.indexOf(task.strategy);
      const batchRetries = task.batchRetries + 1;
      if (batchRetries >= this.deps.config.maxBatchRetries) {
        if (strategyIdx < STRATEGY_ORDER.length - 1) {
          await this.patch(task.id, {
            strategy: STRATEGY_ORDER[strategyIdx + 1],
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

  // ─── 质检阶段（两层：结构脚本 + 语义 qwen-vl） ───────────────────────

  private async advanceQc(task: PetGenTask): Promise<void> {
    const now = this.now();
    const taskDir = this.taskDir(task);
    const statesDir = join(taskDir, 'states');
    const spec = this.specFromTask(task);
    try {
      const structural = await this.deps.structureQc.inspect(statesDir, [...PET_STATE_IDS]);
      const semantic: Record<PetStateId, StateQcResult> = {} as Record<PetStateId, StateQcResult>;
      for (const state of PET_STATE_IDS) {
        const s = structural[state];
        if (!s.pass) {
          // 结构不过不浪费视觉调用；原因并入 issues
          semantic[state] = { pass: false, issues: [`结构质检：${s.issues.join('；')}`] };
          continue;
        }
        semantic[state] = await this.deps.visionQc.inspect({
          referencePath: join(taskDir, 'concept.png'),
          statePath: join(statesDir, `${state}.png`),
          state,
          spec,
        });
      }
      const failed = PET_STATE_IDS.filter(
        (s) => !structural[s].pass || !semantic[s].pass,
      );
      await this.patch(task.id, { qcResult: JSON.stringify(semantic), updatedAt: now });
      if (failed.length === 0) {
        await this.finalize(task);
        return;
      }
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
      // 单状态重试：升级策略（spike 回退条件）+ 只重生成失败状态
      const strategyIdx = STRATEGY_ORDER.indexOf(task.strategy);
      const nextStrategy =
        strategyIdx < STRATEGY_ORDER.length - 1
          ? STRATEGY_ORDER[strategyIdx + 1]
          : task.strategy;
      await this.patch(task.id, {
        status: 'generating_states',
        strategy: nextStrategy,
        qcRetries,
        pendingStates: JSON.stringify(failed),
        batchRetries: 0,
        updatedAt: now,
      });
    } catch (error) {
      await this.fail(task, `质检执行失败：${messageOf(error)}`);
    }
  }

  // ─── 交付：素材落租户 pet-assets 目录 ───────────────────────────────

  private async finalize(task: PetGenTask): Promise<void> {
    const now = this.now();
    const assetsDir = join(tenantDataDir(this.deps.dataDir, task.tenantId), 'pet-assets');
    const taskDir = this.taskDir(task);
    const statesDir = join(taskDir, 'states');
    await mkdir(assetsDir, { recursive: true });
    await copyFile(join(taskDir, 'concept.png'), join(assetsDir, 'concept.png'));
    for (const state of PET_STATE_IDS) {
      await copyFile(join(statesDir, `${state}.png`), join(assetsDir, `${state}.png`));
    }
    // manifest 契约（对齐 PetStateSpec；自定义 IP = 单帧静态 + 播放器微动画）
    const spec = this.specFromTask(task);
    const manifest = {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      spec,
      concept: 'concept.png',
      states: Object.fromEntries(
        PET_STATE_IDS.map((s) => [s, { ...PET_STATES[s], file: s, frames: 1 }]),
      ),
    };
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
  }
}

export { STRATEGY_ORDER, QUAD_BATCHES, taskDirOf };
