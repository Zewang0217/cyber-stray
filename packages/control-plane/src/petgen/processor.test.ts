/**
 * 生成任务处理器测试（#94）—— 异步队列状态机
 *
 * 契约（垂直切片，mock 生图/视觉/切分）：
 * - 概念图：spec_submitted → concept_generating → awaiting_confirmation（conceptPath 落盘）
 * - 确认后：generating_states（四宫格 2x2×3，参考图=概念图）→ qc（两层）→ done
 *   （pet-assets 落 9 状态 PNG + concept.png + manifest.json，frames=1）
 * - 单状态质检失败：保留通过状态，逐状态重生成 + 增量复检；超限整体失败
 * - 批次失败：计数 → quad→nine→per 升级；阶梯到顶 → failed
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
import { createPetUsageRecorder, readTenantUsage } from '../infra/usage.js';
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
  /** 视觉质检 infra 异常开关（inspect 直接 reject，模拟端点断连/key 失效） */
  let inspectRejects: boolean;
  /** 切分抛错策略集（在该策略下抛错 → 触发升级） */
  let splitFailStrategies: Set<string>;
  /** 空格不顺从策略集（emptyCells=0 → 触发升级） */
  let noncomplianceStrategies: Set<string>;
  let conceptFails = false;
  /** sheet 切分漏格数（>0 = 布局不顺从 → 策略失败/降级 strip） */
  let sheetEmptyCells: number;
  /** 非 null 时 fake splitSheet 写 sheet-meta.json（displayScale 决议测试用） */
  let sheetMetaContentHeights: number[] | null = null;
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
    inspectRejects = false;
    splitFailStrategies = new Set();
    noncomplianceStrategies = new Set();
    conceptFails = false;
    sheetEmptyCells = 0;
    joinCalls = [];
    publishMock = vi.fn();
    clock = new Date(2026, 7, 10).getTime();

    generateMock = vi.fn(async ({ kind, outPath, onUsage }) => {
      if (kind === 'concept' && conceptFails) {
        throw new Error('生图 API 500');
      }
      await onUsage?.('doubao-seedream-5-0-260128');
      writeFileSync(outPath, PNG);
      return { imagePath: outPath };
    });
    imageGen = { generate: generateMock };

    inspectMock = vi.fn(async ({ state, onUsage }) => {
      if (inspectRejects) {
        throw new Error('质检端点 503');
      }
      await onUsage?.('glm-4.5v');
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
        // 真实脚本同构：meta 只写本次动画 + 与既有文件按动画键合并
        // （strip 逐动画重生成不抹掉此前动画的测量——P1 修复的镜像）
        const metaPath = join(opts.outDir, 'sheet-meta.json');
        let anims: Record<string, { contentHeights: number[] }> = {};
        try {
          anims = JSON.parse(readFileSync(metaPath, 'utf-8')).anims ?? {};
        } catch { /* 无既有 meta */ }
        if (sheetMetaContentHeights !== null) {
          for (const a of opts.anims) {
            anims[a.state] = { contentHeights: sheetMetaContentHeights };
          }
          writeFileSync(metaPath, JSON.stringify({ anims }));
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
        maxQcInfraRetries: 2,
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

  it('记账写入失败后任务失败，新处理器也不再为该租户生成图片', async () => {
    const tenantDir = join(dataDir, 'tenants', 'alice');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(join(tenantDir, 'usage'), 'broken usage directory');
    deps.usage = createPetUsageRecorder(dataDir);
    processor = new PetGenProcessor(deps);
    const first = await insertTask();
    await processor.tick();
    expect((await getTask(first.id))?.status).toBe('failed');
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(existsSync(join(tenantDir, 'usage-accounting-block.json'))).toBe(true);
    rmSync(join(tenantDir, 'usage'));
    const second = await insertTask();
    await new PetGenProcessor(deps).tick();
    expect((await getTask(second.id))?.status).toBe('failed');
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it.each(['quad', 'sheet'] as const)('%s 完整调用链每次成功响应只记一次，模型来自 provider', async (strategy) => {
    deps.usage = createPetUsageRecorder(dataDir);
    processor = new PetGenProcessor(deps);
    const task = await insertTask({ strategy });
    if (strategy === 'quad') {
      await tickUntil(task.id, ['awaiting_confirmation']);
      await confirm(task.id);
    }
    await tickUntil(task.id, ['done']);
    const entries = await readTenantUsage(dataDir, 'alice');
    expect(entries.filter((entry) => entry.kind === 'image')).toHaveLength(generateMock.mock.calls.length);
    expect(entries.filter((entry) => entry.kind === 'vision_qc')).toHaveLength(inspectMock.mock.calls.length);
    expect(entries.filter((entry) => entry.kind === 'image').every((entry) => entry.model === 'doubao-seedream-5-0-260128')).toBe(true);
    expect(entries.filter((entry) => entry.kind === 'vision_qc').every((entry) => entry.model === 'glm-4.5v')).toBe(true);
  });

  it('质检记账故障当轮失败，只等待两个已在飞调用且不再派发', async () => {
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    await tickUntil(task.id, ['qc']);
    const tenantDir = join(dataDir, 'tenants', 'alice');
    writeFileSync(join(tenantDir, 'usage'), 'broken ledger path');
    deps.usage = createPetUsageRecorder(dataDir);
    await processor.tick();
    expect((await getTask(task.id))?.status).toBe('failed');
    expect(inspectMock).toHaveBeenCalledTimes(2);
    expect(existsSync(join(tenantDir, 'usage-accounting-block.json'))).toBe(true);
    await new PetGenProcessor(deps).tick();
    expect(inspectMock).toHaveBeenCalledTimes(2);
  });

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

  it('单状态质检失败：保留已通过八态，逐态重生失败态后二次验收 → done', async () => {
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    qcFailures = new Set(['joy']); // 第一轮质检 joy 不合格
    await tickUntil(task.id, ['qc']);
    const afterFail = await tickUntil(task.id, ['generating_states']);
    expect(afterFail.qcRetries).toBe(1);
    expect(afterFail.strategy).toBe('per');
    expect(afterFail.pendingStates).toContain('joy');

    qcFailures = new Set();
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    expect(done.strategy).toBe('per');
    expect(inspectMock).toHaveBeenCalledTimes(10); // 首轮九态 + 变化的 joy
    const gridCalls = generateMock.mock.calls.filter(([r]) => r.kind === 'grid');
    expect(gridCalls).toHaveLength(4);
    expect(gridCalls[3]?.[0].outPath).toContain('g-per-joy.png');
  });

  it('per 单态重生后仅重查变化状态，保留其余八态已通过的质检', async () => {
    const previousQc = Object.fromEntries(ALL_STATES.map((state) => [
      state, state === 'joy'
        ? { pass: false, issues: ['动作不符'] }
        : { pass: true, issues: [] },
    ]));
    const task = await insertTask({
      status: 'generating_states', strategy: 'per', qcRetries: 2,
      pendingStates: JSON.stringify(['joy']), qcResult: JSON.stringify(previousQc),
    });
    const taskDir = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', task.id);
    mkdirSync(join(taskDir, 'states'), { recursive: true });
    writeFileSync(join(taskDir, 'concept.png'), PNG);
    for (const state of ALL_STATES) writeFileSync(join(taskDir, 'states', `${state}.png`), PNG);
    const originalGenerate = generateMock.getMockImplementation()!;
    generateMock.mockImplementation(async (req) => {
      clock += 60_000;
      return originalGenerate(req);
    });
    const originalInspect = inspectMock.getMockImplementation()!;
    inspectMock.mockImplementation(async (req) => {
      clock += 20_000;
      return originalInspect(req);
    });
    const started = clock;

    await processor.tick();
    expect((await getTask(task.id))?.status).toBe('qc');
    await processor.tick();

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(inspectMock).toHaveBeenCalledTimes(1);
    expect(clock - started).toBe(80_000);
    expect((await getTask(task.id))?.status).toBe('done');
  });

  it('quad 重生成批内三态必须全部重查，批外六态可复用已通过结果', async () => {
    const previousQc = Object.fromEntries(ALL_STATES.map((state) => [
      state, state === 'joy'
        ? { pass: false, issues: ['动作不符'] }
        : { pass: true, issues: [] },
    ]));
    const task = await insertTask({
      status: 'generating_states', strategy: 'quad', qcRetries: 1,
      pendingStates: JSON.stringify(['joy']), qcResult: JSON.stringify(previousQc),
    });
    const taskDir = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', task.id);
    mkdirSync(join(taskDir, 'states'), { recursive: true });
    writeFileSync(join(taskDir, 'concept.png'), PNG);
    for (const state of ALL_STATES) writeFileSync(join(taskDir, 'states', `${state}.png`), PNG);

    await processor.tick();
    await processor.tick();

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(inspectMock.mock.calls.map(([req]) => req.state)).toEqual(['idle', 'walk', 'joy']);
    expect((await getTask(task.id))?.status).toBe('done');
  });

  it('per 多态生成最多两个请求在飞，并缩短串行等待', async () => {
    const task = await insertTask({
      status: 'generating_states', strategy: 'per',
      pendingStates: JSON.stringify(['idle', 'walk', 'joy', 'eat']),
    });
    const taskDir = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', task.id);
    mkdirSync(join(taskDir, 'states'), { recursive: true });
    writeFileSync(join(taskDir, 'concept.png'), PNG);
    const originalGenerate = generateMock.getMockImplementation()!;
    let active = 0;
    let peak = 0;
    generateMock.mockImplementation(async (req) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result = await originalGenerate(req);
      active--;
      return result;
    });
    deps.usage = createPetUsageRecorder(dataDir);

    await processor.tick();

    expect(generateMock).toHaveBeenCalledTimes(4);
    expect((await readTenantUsage(dataDir, 'alice')).filter((entry) => entry.kind === 'image')).toHaveLength(4);
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect((await getTask(task.id))?.status).toBe('qc');
  });

  it('并行生图首个失败后不派新请求，等待另一在飞调用记账后才收尾', async () => {
    const task = await insertTask({
      status: 'generating_states', strategy: 'per',
      pendingStates: JSON.stringify(['idle', 'walk', 'joy', 'eat']),
    });
    const taskDir = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', task.id);
    mkdirSync(join(taskDir, 'states'), { recursive: true });
    writeFileSync(join(taskDir, 'concept.png'), PNG);
    const originalGenerate = generateMock.getMockImplementation()!;
    const recordImage = vi.fn(async () => {});
    deps.usage = { recordImage, recordVision: vi.fn(async () => {}) };
    let secondFinished = false;
    generateMock.mockImplementation(async (req) => {
      if (req.outPath.includes('g-per-idle.png')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('首张生图失败');
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await originalGenerate(req);
      secondFinished = true;
      return result;
    });

    await processor.tick();

    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(secondFinished).toBe(true);
    expect(recordImage).toHaveBeenCalledOnce();
    expect((await getTask(task.id))?.status).toBe('generating_states');
  });

  it('视觉质检最多两个请求在飞，仍完成九态全检', async () => {
    const task = await insertTask({ status: 'qc' });
    const taskDir = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', task.id);
    mkdirSync(join(taskDir, 'states'), { recursive: true });
    writeFileSync(join(taskDir, 'concept.png'), PNG);
    for (const state of ALL_STATES) writeFileSync(join(taskDir, 'states', `${state}.png`), PNG);
    const originalInspect = inspectMock.getMockImplementation()!;
    let active = 0;
    let peak = 0;
    inspectMock.mockImplementation(async (req) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result = await originalInspect(req);
      active--;
      return result;
    });
    deps.usage = createPetUsageRecorder(dataDir);

    await processor.tick();

    expect(inspectMock).toHaveBeenCalledTimes(9);
    expect((await readTenantUsage(dataDir, 'alice')).filter((entry) => entry.kind === 'vision_qc')).toHaveLength(9);
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect((await getTask(task.id))?.status).toBe('done');
  });

  it('单态内容失败的完整处理器路径按两路请求与增量复检完成', async () => {
    const task = await insertTask({ status: 'generating_states' });
    const taskDir = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', task.id);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'concept.png'), PNG);
    const originalGenerate = generateMock.getMockImplementation()!;
    const originalInspect = inspectMock.getMockImplementation()!;
    const nativeSetTimeout = setTimeout;
    const sleepReal = (ms: number) => new Promise<void>((resolve) => nativeSetTimeout(resolve, ms));
    let imageTimersArmed = 0;
    let qcTimersArmed = 0;
    generateMock.mockImplementation(async (req) => {
      // Provider request preparation and response handling are real async work.
      // The second request deliberately arms its fake timer later than the first.
      if (generateMock.mock.calls.length === 2) {
        await sleepReal(30);
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 60_000);
        imageTimersArmed++;
      });
      await sleepReal(10);
      return originalGenerate(req);
    });
    inspectMock.mockImplementation(async (req) => {
      if (inspectMock.mock.calls.length === 2) await sleepReal(30);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20_000);
        qcTimersArmed++;
      });
      await sleepReal(10);
      return originalInspect(req);
    });
    qcFailures.add('joy');
    vi.useFakeTimers();
    const started = Date.now();
    const waitForArmed = async (count: () => number, expected: number) => {
      for (let i = 0; i < 2_000 && count() < expected; i++) await sleepReal(5);
      expect(count()).toBe(expected);
    };
    try {
      const initialImages = processor.tick();
      for (const count of [2, 3]) {
        await waitForArmed(() => imageTimersArmed, count);
        await vi.advanceTimersByTimeAsync(60_000);
      }
      await initialImages; // quad 三张图，两路请求，耗时两波

      const initialQc = processor.tick();
      for (const count of [2, 4, 6, 8, 9]) {
        await waitForArmed(() => qcTimersArmed, count);
        await vi.advanceTimersByTimeAsync(20_000);
      }
      await initialQc; // 九态质检，两路请求，耗时五波
      qcFailures.clear();

      const repairedImage = processor.tick();
      await waitForArmed(() => imageTimersArmed, 4);
      await vi.advanceTimersByTimeAsync(60_000);
      await repairedImage; // per 仅重生 joy

      const repairedQc = processor.tick();
      await waitForArmed(() => qcTimersArmed, 10);
      await vi.advanceTimersByTimeAsync(20_000);
      await repairedQc; // 仅复检 joy 并交付

      expect(Date.now() - started).toBe(300_000);
      expect(generateMock).toHaveBeenCalledTimes(4);
      expect(inspectMock).toHaveBeenCalledTimes(10);
      expect((await getTask(task.id))?.status).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

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

  it('视觉质检 infra 异常：保持 qc 态只重试质检，恢复后完成（不重生成图）', async () => {
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    await tickUntil(task.id, ['qc']);
    const genCallsAtQc = generateMock.mock.calls.length;

    inspectRejects = true; // 供应商故障（端点 503）
    await processor.tick();
    const stuck = await getTask(task.id);
    expect(stuck?.status).toBe('qc'); // 不打回 generating_states、不消耗 qcRetries
    expect(stuck?.qcRetries).toBe(0);
    expect(generateMock.mock.calls.length).toBe(genCallsAtQc); // 没有白烧生图

    inspectRejects = false; // 故障恢复
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    expect(generateMock.mock.calls.length).toBe(genCallsAtQc); // 恢复后直接过检交付
  });

  it('视觉质检 infra 异常连续超限 → failed 带真实异常文案（非「调整 spec」）', async () => {
    const task = await insertTask();
    await tickUntil(task.id, ['awaiting_confirmation']);
    await confirm(task.id);
    await tickUntil(task.id, ['qc']);
    const genCallsAtQc = generateMock.mock.calls.length;

    inspectRejects = true;
    await processor.tick(); // 第 1 轮 infra 重试
    await processor.tick(); // 第 2 轮 = maxQcInfraRetries → failed
    const failed = await getTask(task.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('视觉质检连续异常');
    expect(failed?.error).toContain('质检端点 503');
    expect(failed?.error).not.toContain('调整 spec');
    expect(generateMock.mock.calls.length).toBe(genCallsAtQc); // 全程零重生成
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

  // 领养精灵图（sheet/strip 阶梯）

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

  it('精灵图漏格：重试后降级 strip 逐动画重生成 → done（displayScale 经 meta 合并存活）', async () => {
    sheetEmptyCells = 16; // sheet 全漏格（布局不顺从）
    sheetMetaContentHeights = [52, 52, 52, 52]; // 降级路径的测量来源
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
    // strip 逐动画重生成不抹 idle 测量：displayScale 照常决议（回归锚：
    // 真实脚本按动画键合并 meta，覆盖写会让招牌特性在降级路径静默失效）
    const manifest = JSON.parse(
      readFileSync(join(dataDir, 'tenants', 'alice', 'pet-assets', 'manifest.json'), 'utf-8'),
    ) as { sprite: { displayScale?: number } };
    expect(manifest.sprite.displayScale).toBe(2);
    sheetMetaContentHeights = null;
  });

  it('精灵图内容高测量：sheet-meta 有 idle 内容高 → manifest 决议 displayScale', async () => {
    // 第 10 轮实测：内容高 52px → round(84/52)=2 → 街上 104px（内置猫 84px 基准带）
    sheetMetaContentHeights = [52, 52, 52, 52];
    const task = await insertTask({ strategy: 'sheet', stylePreset: 'pixel' });
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    const manifest = JSON.parse(
      readFileSync(join(dataDir, 'tenants', 'alice', 'pet-assets', 'manifest.json'), 'utf-8'),
    ) as { sprite: { contentHeight?: number; displayScale?: number } };
    expect(manifest.sprite.contentHeight).toBe(52);
    expect(manifest.sprite.displayScale).toBe(2);
    sheetMetaContentHeights = null;
  });

  it('精灵图无 meta（旧脚本产物）→ manifest 不带展示缩放字段（web 回退 3）', async () => {
    const task = await insertTask({ strategy: 'sheet', stylePreset: 'pixel' });
    const done = await tickUntil(task.id, ['done']);
    expect(done.status).toBe('done');
    const manifest = JSON.parse(
      readFileSync(join(dataDir, 'tenants', 'alice', 'pet-assets', 'manifest.json'), 'utf-8'),
    ) as { sprite: { contentHeight?: number; displayScale?: number } };
    expect(manifest.sprite.contentHeight).toBeUndefined();
    expect(manifest.sprite.displayScale).toBeUndefined();
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
