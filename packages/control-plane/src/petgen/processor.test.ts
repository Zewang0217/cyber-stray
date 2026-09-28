/**
 * 生成任务处理器测试（#94）—— 异步队列状态机
 *
 * 契约（垂直切片，mock 生图/视觉/切分）：
 * - 概念图：spec_submitted → concept_generating → awaiting_confirmation（conceptPath 落盘）
 * - 确认后：generating_states（四宫格 2x2×3，参考图=概念图）→ qc（两层）→ done
 *   （pet-assets 落 9 状态 PNG + concept.png + manifest.json，frames=1）
 * - 单状态质检失败：重试 + 策略升级（quad→nine→per），maxQcRetries 后整体失败
 * - 批次失败：计数 → 升级策略；阶梯到顶 → failed
 * - 空格不顺从（2x2 画满 4 格）→ 放弃 2x2 升级九宫格
 * - 租户隔离：同租户在飞任务互斥；概念图失败 → failed 带明确原因；崩溃恢复
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb, type ControlDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../infra/tenant.js';
import { petGenTasks, pets, tenants, type PetGenTask } from '../db/schema.js';
import { PetGenProcessor } from './processor.js';
import { petGenQuota } from './quota.js';
import type { PetStateId } from '@cyber-stray/shared/pet';
import type {
  GenStrategy,
  ImageGenerator,
  ImageGenRequest,
  PetGenProcessorDeps,
  Splitter,
  StateQcResult,
  StructureQc,
  VisionQc,
  VisionQcRequest,
} from './types.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** 1024×64 透明 PNG（16 帧 × 64px 总条的真实 IHDR；finalize 宽度断言用） */
const SPRITE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAABAAAAABACAYAAACECgX8AAABFUlEQVR42u3BMQEAAADCoPVPbQlPoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvgYAfAABiPi+ewAAAABJRU5ErkJggg==',
  'base64',
);

const ALL_STATES: PetStateId[] = [
  'idle', 'walk', 'joy', 'eat', 'sleep', 'think', 'celebrate', 'grumpy', 'welcome',
];

describe('PetGenProcessor（#94 状态机）', () => {
  let dataDir: string;
  let db: ControlDb;
  let generateMock: ReturnType<typeof vi.fn<(req: ImageGenRequest) => Promise<{ imagePath: string }>>>;
  let inspectMock: ReturnType<typeof vi.fn<(req: VisionQcRequest) => Promise<StateQcResult>>>;
  let imageGen: ImageGenerator;
  let visionQc: VisionQc;
  let structureQc: StructureQc;
  let splitter: Splitter;
  let deps: PetGenProcessorDeps;
  let processor: PetGenProcessor;
  /** 视觉质检失败状态集（清空 = 该状态下一轮通过） */
  let qcFailures: Set<PetStateId>;
  /** 切分抛错策略集（在该策略下抛错 → 触发升级） */
  let splitFailStrategies: Set<string>;
  /** 空格不顺从策略集（emptyCells=0 → 触发升级） */
  let noncomplianceStrategies: Set<string>;
  let conceptFails = false;
  /** sheet 切分漏格数（>0 = 布局不顺从 → 策略失败/降级 strip） */
  let sheetEmptyCells: number;
  /** joinSprite 调用记录（每次收到的动画次序） */
  let joinCalls: PetStateId[][];
  let publishMock: ReturnType<typeof vi.fn<(tenantId: string, event: { type: string }) => void>>;
  let clock = Date.now();

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-petgen-proc-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    db = await getDb(dataDir);
    await db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, 'alice')).run();
    await db.update(tenants).set({ plan: 'byok' }).where(eq(tenants.id, 'bob')).run();
    qcFailures = new Set();
    splitFailStrategies = new Set();
    noncomplianceStrategies = new Set();
    conceptFails = false;
    sheetEmptyCells = 0;
    joinCalls = [];
    publishMock = vi.fn();
    clock = new Date(2026, 7, 10).getTime();

    generateMock = vi.fn(async ({ kind, outPath }) => {
      if (kind === 'concept' && conceptFails) {
        throw new Error('生图 API 500');
      }
      writeFileSync(outPath, PNG);
      return { imagePath: outPath };
    });
    imageGen = { generate: generateMock };

    inspectMock = vi.fn(async ({ state }) => {
      if (qcFailures.has(state)) {
        return { pass: false, issues: ['状态未区分(与 idle 相关 <0.25)'] };
      }
      return { pass: true, issues: [] };
    });
    visionQc = { inspect: inspectMock };

    structureQc = {
      inspect: async (): Promise<Record<PetStateId, StateQcResult>> => {
        const all = {} as Record<PetStateId, StateQcResult>;
        for (const s of ALL_STATES) all[s] = { pass: true, issues: [] };
        return all;
      },
    };

    splitter = {
      splitGrid: async (gridPath, states, { outDir }) => {
        for (const state of states) writeFileSync(join(outDir, `${state}.png`), PNG);
        return {
          files: Object.fromEntries(states.map((s) => [s, join(outDir, `${s}.png`)])) as Record<PetStateId, string>,
          emptyCells: 1,
        };
      },
      splitSheet: async (_gridPath, opts) => {
        const files: Record<string, string> = {};
        const frames: Record<string, number> = {};
        const ratios: Record<string, number[]> = {};
        // strip 降级（rows=1）恒成功；sheet 漏格由 sheetEmptyCells 驱动
        const emptyCells = opts.rows === 1 ? 0 : sheetEmptyCells;
        for (const a of opts.anims) {
          writeFileSync(join(opts.outDir, `${a.state}.png`), PNG);
          files[a.state] = join(opts.outDir, `${a.state}.png`);
          frames[a.state] = a.frames;
          ratios[a.state] = [];
        }
        // 与真实脚本同形：splitSheet 写本次动画的总条（strip 行条 = 单动画窄条）
        if (opts.rows === opts.cols) {
          writeFileSync(join(opts.outDir, 'sprite.png'), SPRITE_PNG);
        }
        return { files, frames, emptyCells, ratios };
      },
      joinSprite: async (outDir, anims) => {
        joinCalls.push(anims.map((a) => a.state));
        writeFileSync(join(outDir, 'sprite.png'), SPRITE_PNG);
      },
      upscaleForQc: async (srcPath, outDir) => {
        const stem = srcPath.split('/').pop()!.replace('.png', '');
        const dst = join(outDir, `${stem}.qc.png`);
        writeFileSync(dst, PNG);
        return dst;
      },
      normalizeConcept: async (_src, outPath) => {
        writeFileSync(outPath, PNG);
        return outPath;
      },
      flattenReference: async (_src, outPath) => {
        writeFileSync(outPath, PNG);
        return outPath;
      },
    };
    deps = {
      dataDir,
      db,
      imageGen,
      visionQc,
      structureQc,
      splitter,
      config: {
        maxBatchRetries: 2,
        maxQcRetries: 2,
        conceptFrame: 512,
        referenceFrame: 384,
        gridSize: '1024*1024',
      },
      now: () => clock,
      bus: { publish: publishMock },
    };
    processor = new PetGenProcessor(deps);
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function insertTask(overrides: Partial<PetGenTask> = {}): Promise<PetGenTask> {
    const row: PetGenTask = {
      id: `t${Math.random().toString(36).slice(2, 8)}`,
      tenantId: 'alice',
      status: 'spec_submitted',
      specText: '一只戴红色围巾的橘猫',
      options: null,
      stylePreset: 'chibi-kawaii',
      conceptPath: null,
      strategy: 'quad',
      batchRetries: 0,
      qcRetries: 0,
      qcResult: null,
      pendingStates: null,
      conceptAttempts: 0,
      error: null,
      completedAt: null,
      createdAt: clock,
      updatedAt: clock,
      ...overrides,
    };
    await db.insert(petGenTasks).values(row).run();
    return row;
  }

  async function getTask(id: string): Promise<PetGenTask | undefined> {
    return db.select().from(petGenTasks).where(eq(petGenTasks.id, id)).get();
  }

  /** 连续 tick 直到任务到达某状态或达上限 */
  async function tickUntil(id: string, statuses: PetGenTask['status'][], max = 40): Promise<PetGenTask> {
    for (let i = 0; i < max; i++) {
      await processor.tick();
      const task = await getTask(id);
      if (task && statuses.includes(task.status)) return task;
    }
    const last = await getTask(id);
    throw new Error(`tickUntil 超限；最后状态: ${last?.status}，error: ${last?.error}`);
  }

  /** 连续 tick 直到任务策略变为目标值（批次失败升级用） */
  async function tickUntilStrategy(id: string, strategies: GenStrategy[], max = 40): Promise<PetGenTask> {
    for (let i = 0; i < max; i++) {
      await processor.tick();
      const task = await getTask(id);
      if (task && strategies.includes(task.strategy)) return task;
    }
    throw new Error(`tickUntilStrategy 超限；最后策略: ${(await getTask(id))?.strategy}`);
  }

  /** 确认概念图（route 动作） */
  async function confirm(id: string): Promise<void> {
    await db.update(petGenTasks).set({ status: 'generating_states', updatedAt: clock }).where(eq(petGenTasks.id, id)).run();
  }

  it('无任务 → tick 返回 false', async () => {
    expect(await processor.tick()).toBe(false);
  });

  it('完整流程：spec → 概念图 → 确认 → 四宫格生成 → 两层质检 → done 落盘', async () => {
    const task = await insertTask();
    const awaiting = await tickUntil(task.id, ['awaiting_confirmation']);
    expect(awaiting.status).toBe('awaiting_confirmation');
    expect(awaiting.conceptPath).toContain('concept.png');
    expect(awaiting.conceptAttempts).toBe(1);
    const conceptCall = generateMock.mock.calls.find(([r]) => r.kind === 'concept');
    expect(conceptCall?.[0].prompt).toContain('戴红色围巾的橘猫');
    expect(conceptCall?.[0].prompt).toContain('#00FF00');

    await confirm(task.id);
    await tickUntil(task.id, ['qc']);
    // 四宫格主路径：3 张 grid 各 3 状态；参考图=概念图压平
    const gridCalls = generateMock.mock.calls.filter(([r]) => r.kind === 'grid');
    expect(gridCalls).toHaveLength(3);
    for (const [req] of gridCalls) {
      expect(req.reference).toContain('reference.jpg');
    }

    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeTruthy();
    expect(done.error).toBeNull();

    const assetsDir = join(dataDir, 'tenants', 'alice', 'pet-assets');
    for (const s of ALL_STATES) {
      expect(existsSync(join(assetsDir, `${s}.png`)), `${s}.png 缺失`).toBe(true);
    }
    expect(existsSync(join(assetsDir, 'concept.png'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(assetsDir, 'manifest.json'), 'utf-8')) as {
      version: number;
      concept: string;
      states: Record<string, { file: string; frames: number; dur: number; label: string }>;
    };
    expect(manifest.version).toBe(1);
    expect(manifest.concept).toBe('concept.png');
    expect(Object.keys(manifest.states)).toHaveLength(9);
    expect(manifest.states['idle']).toMatchObject({ file: 'idle', frames: 1, label: '待机呼吸' });
    expect(manifest.states['welcome']?.dur).toBeGreaterThan(0);
    const quota = await petGenQuota(db, 'alice', 2, clock);
    expect(quota.used).toBe(1);
  });

  it('单状态质检失败：重试 + 升级九宫格，二次全过 → done', async () => {
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    qcFailures = new Set(['joy']); // 第一轮质检 joy 不合格
    await tickUntil(task.id, ['qc']);
    const afterFail = await tickUntil(task.id, ['generating_states']);
    expect(afterFail.qcRetries).toBe(1);
    expect(afterFail.strategy).toBe('nine'); // 升级九宫格（spike 回退条件）
    expect(afterFail.pendingStates).toContain('joy');

    qcFailures = new Set();
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    expect(done.strategy).toBe('nine');
    // 九宫格整张重生成：第 4 次 grid 调用是 3x3
    const gridCalls = generateMock.mock.calls.filter(([r]) => r.kind === 'grid');
    expect(gridCalls).toHaveLength(4);
    expect(gridCalls[3]?.[0].prompt).toContain('3x3');
  });

  it('质检重试超限 → failed 带失败状态明细（失败不占配额）', async () => {
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    qcFailures = new Set(['idle', 'walk']);
    await tickUntil(task.id, ['qc']); // 首轮生成 → qc（失败）
    await tickUntil(task.id, ['qc']); // 重试（nine）→ qc（再失败）
    const failed = await tickUntil(task.id, ['failed']);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('质检多次不合格');
    expect(failed.error).toContain('idle');
    expect(failed.qcRetries).toBe(2);
    const quota = await petGenQuota(db, 'alice', 2, clock);
    expect(quota.used).toBe(0);
  });

  it('批次失败（切分抛错）：quad 失败 → 升级 nine 仍失败 → 升级 per 成功', async () => {
    splitter.splitGrid = async (_grid, states, { outDir }) => {
      if (splitFailStrategies.has('quad') || splitFailStrategies.has('nine')) {
        throw new Error('切分检测失败');
      }
      for (const state of states) writeFileSync(join(outDir, `${state}.png`), PNG);
      return {
        files: Object.fromEntries(
          states.map((s) => [s, join(outDir, `${s}.png`)]),
        ) as Record<PetStateId, string>,
        emptyCells: 1,
      };
    };
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    splitFailStrategies = new Set(['quad', 'nine']);
    // quad 连续 maxBatchRetries(2) 次失败 → nine
    const escalated = await tickUntilStrategy(task.id, ['nine']);
    expect(escalated.strategy).toBe('nine');
    // nine 连续 2 次失败 → per
    const escalated2 = await tickUntilStrategy(task.id, ['per']);
    expect(escalated2.strategy).toBe('per');
    splitFailStrategies = new Set(); // 清空后 per 成功
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    expect(done.strategy).toBe('per');
  });

  it('策略阶梯到顶（per）仍失败 → failed 明确反馈', async () => {
    splitter.splitGrid = async () => {
      throw new Error('切分持续失败');
    };
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    // quad ×2 → nine ×2 → per ×2 → failed
    const failed = await tickUntil(task.id, ['failed']);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('多次失败');
    expect(failed.strategy).toBe('per');
  });

  it('空格不顺从（2x2 画满 4 格）→ 放弃 2x2 升级九宫格', async () => {
    splitter.splitGrid = async (_grid, states, { outDir }) => {
      for (const state of states) writeFileSync(join(outDir, `${state}.png`), PNG);
      return {
        files: Object.fromEntries(states.map((s) => [s, join(outDir, `${s}.png`)])) as Record<PetStateId, string>,
        emptyCells: noncomplianceStrategies.has('quad') ? 0 : 1,
      };
    };
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    noncomplianceStrategies = new Set(['quad']);
    const escalated = await tickUntilStrategy(task.id, ['nine']);
    expect(escalated.strategy).toBe('nine');
    noncomplianceStrategies = new Set();
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
  });

  it('概念图失败 → failed 带原因；失败任务不占配额', async () => {
    conceptFails = true;
    const task = await insertTask();
    const failed = await tickUntil(task.id, ['failed']);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('概念图生成失败');
    expect(failed.error).toContain('生图 API 500');
  });

  it('崩溃恢复：卡在 concept_generating 的任务下一 tick 重新推进', async () => {
    const task = await insertTask({ status: 'concept_generating', conceptAttempts: 2 });
    const awaiting = await tickUntil(task.id, ['awaiting_confirmation']);
    expect(awaiting.status).toBe('awaiting_confirmation');
    expect(awaiting.conceptAttempts).toBe(3);
  });

  it('租户隔离：同租户在飞任务阻塞后续任务；他租户任务可推进', async () => {
    await insertTask({ id: 'a1' });
    await insertTask({ id: 'a2' });
    await insertTask({ id: 'b1', tenantId: 'bob' });
    await db.update(petGenTasks).set({ status: 'qc', updatedAt: clock }).where(eq(petGenTasks.id, 'a1')).run();
    const advanced = await processor.tick();
    expect(advanced).toBe(true);
    const a2Task = await getTask('a2');
    expect(a2Task?.status).toBe('spec_submitted'); // alice 有在飞 a1 → a2 阻塞
    const b1Task = await getTask('b1');
    expect(b1Task?.status).toBe('awaiting_confirmation'); // bob 无在飞 → 推进
  });

  it('restart 后（spec_submitted）概念图重出：conceptAttempts 递增', async () => {
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await db.update(petGenTasks).set({
      specText: '一只蓝色小狗',
      status: 'spec_submitted',
      conceptPath: null,
      updatedAt: clock,
    }).where(eq(petGenTasks.id, task.id)).run();
    const awaiting = await tickUntil(task.id, ['awaiting_confirmation']);
    expect(awaiting.conceptAttempts).toBe(2);
    const conceptCalls = generateMock.mock.calls.filter(([r]) => r.kind === 'concept');
    expect(conceptCalls).toHaveLength(2);
    expect(conceptCalls[1]?.[0].prompt).toContain('蓝色小狗');
  });

  // ─── 领养精灵图（sheet/strip 阶梯）───

  it('精灵图：自动确认跳过 awaiting_confirmation，单张 4x4 生成 → done 带 sprite 块 + 事件', async () => {
    // 宠物行存在 → done 后发 pet_assets_ready
    await db.insert(pets).values({
      id: 'pet-1',
      tenantId: 'alice',
      name: '阿橘',
      status: 'active',
      boredom: 75,
      energy: 80,
      mood: 'curious',
      temper: 20,
      personality: 'curious',
      catchphrases: '[]',
      createdAt: clock,
      updatedAt: clock,
    }).run();
    const task = await insertTask({ strategy: 'sheet', stylePreset: 'pixel' });
    const generating = await tickUntil(task.id, ['generating_states']);
    expect(generating.status).toBe('generating_states'); // 自动确认：不停驻等待
    const conceptCalls = generateMock.mock.calls.filter(([r]) => r.kind === 'concept');
    expect(conceptCalls).toHaveLength(1); // 无上传参考图 → 出概念图锚角色

    const done = await tickUntil(task.id, ['done']);
    const sheetCalls = generateMock.mock.calls.filter(([r]) => r.kind === 'sheet');
    expect(sheetCalls).toHaveLength(1);
    expect(sheetCalls[0]?.[0].prompt).toContain('4x4');
    expect(sheetCalls[0]?.[0].prompt).toContain('待机呼吸');
    expect(sheetCalls[0]?.[0].reference).toContain('reference.jpg');

    const assetsDir = join(dataDir, 'tenants', 'alice', 'pet-assets');
    expect(existsSync(join(assetsDir, 'sprite.png'))).toBe(true);
    for (const s of ['idle', 'walk', 'sleep', 'grumpy', 'joy', 'welcome', 'think']) {
      expect(existsSync(join(assetsDir, `${s}.png`)), `${s}.png 缺失`).toBe(true);
    }
    const manifest = JSON.parse(readFileSync(join(assetsDir, 'manifest.json'), 'utf-8')) as {
      version: number;
      sprite: {
        image: string;
        frame: { w: number; h: number; groundRow: number };
        animations: Record<string, { from: number; frames: number; duration: number; loop: boolean }>;
      };
      states: Record<string, { file: string; frames: number }>;
    };
    expect(manifest.version).toBe(2);
    expect(manifest.sprite.image).toBe('sprite.png');
    expect(manifest.sprite.frame).toEqual({ w: 64, h: 64, groundRow: 63 });
    expect(manifest.sprite.animations.idle).toEqual({ from: 0, frames: 4, duration: 0.8, loop: true });
    expect(manifest.sprite.animations.walk?.from).toBe(4);
    expect(manifest.sprite.animations.think?.from).toBe(14);
    expect(Object.keys(manifest.states)).toHaveLength(7);
    expect(publishMock).toHaveBeenCalledWith('alice', expect.objectContaining({
      type: 'pet_assets_ready',
      petId: 'pet-1',
    }));
  });

  it('精灵图漏格：重试后降级 strip 逐动画重生成 → done', async () => {
    sheetEmptyCells = 16; // sheet 全漏格（布局不顺从）
    const task = await insertTask({ strategy: 'sheet', stylePreset: 'pixel' });
    await tickUntil(task.id, ['generating_states']);
    const downgraded = await tickUntilStrategy(task.id, ['strip']);
    expect(downgraded.strategy).toBe('strip'); // sheet→strip 阶梯降级（不落 per）
    sheetEmptyCells = 0;
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    // strip：6 动画各一行 1×N 行条；完毕后总条按全动画次序重建（防单动画覆盖）
    const stripCalls = generateMock.mock.calls.filter(([r]) => r.kind === 'sheet');
    expect(stripCalls.length).toBeGreaterThanOrEqual(6);
    expect(joinCalls).toHaveLength(1);
    expect(joinCalls[0]).toEqual(['idle', 'walk', 'sleep', 'grumpy', 'joy', 'welcome', 'think']);
    expect(existsSync(join(dataDir, 'tenants', 'alice', 'pet-assets', 'sprite.png'))).toBe(true);
  });

  it('精灵图 + 上传参考图：跳过概念图，语义锚点用上传参考图', async () => {
    const adoptRef = join(dataDir, 'tenants', 'alice', 'pet-assets', 'adopt-reference.jpg');
    mkdirSync(dirname(adoptRef), { recursive: true });
    writeFileSync(adoptRef, PNG);
    const task = await insertTask({ strategy: 'sheet', stylePreset: 'pixel' });
    const generating = await tickUntil(task.id, ['generating_states']);
    expect(generating.status).toBe('generating_states');
    expect(generateMock.mock.calls.filter(([r]) => r.kind === 'concept')).toHaveLength(0);
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    // 语义质检锚点 = 上传参考图（reference.jpg），非 concept.png
    const visionCall = inspectMock.mock.calls[0]?.[0];
    expect(visionCall?.referencePath).toContain('reference.jpg');
    // 无 concept.png → manifest 不带 concept 字段
    const manifest = JSON.parse(
      readFileSync(join(dataDir, 'tenants', 'alice', 'pet-assets', 'manifest.json'), 'utf-8'),
    ) as { concept?: string };
    expect(manifest.concept).toBeUndefined();
  });
});
