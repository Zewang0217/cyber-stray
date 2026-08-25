/**
 * evolution 路由 — /api/evolution*（S13 进化可视化 + 回滚）
 *
 * 用户可追溯宠物进化过程：兴趣快照时间序列（interest-history.jsonl，
 * S9 起由 agent persist 落盘）+ 反馈事件（feedback.json）+ 游荡摘要
 * （state.json）。回滚：把某快照的兴趣权重还原为 interests.json
 * （原子写），并追加一条 source=rollback 快照——可追溯 + 可撤销。
 *
 * 安全：租户只由 session claim 决定（x-tenant-* 忽略）；回滚 hash 查找
 * 限本租户历史，他租户的 hash 统一 404（不暴露存在性）。
 */

import { Hono } from 'hono';
import { readFile, writeFile, appendFile, rename } from 'fs/promises';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { ControlPlaneConfig } from '../config.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface EvolutionDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 鉴权 + 租户校验：401 / 403 / { tenantId, dir }（与 data.ts 同规矩） */
async function scopedTenant(
  req: Request,
  config: EvolutionDeps['config'],
): Promise<{ tenantId: string; dir: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };
  return { tenantId: session.tenantId, dir: tenantDataDir(config.dataDir, session.tenantId) };
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

interface Snapshot {
  timestamp: string;
  hash: string;
  entropy: number;
  nodes: Array<Record<string, unknown>>;
  source?: string;
}

/** 读 interest-history.jsonl 全部快照（坏行跳过，非 ENOENT 显式抛） */
async function readSnapshots(dir: string): Promise<Snapshot[]> {
  let content: string;
  try {
    content = await readFile(join(dir, 'interest-history.jsonl'), 'utf-8');
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  const snapshots: Snapshot[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<Snapshot>;
      if (
        typeof parsed.timestamp === 'string' &&
        typeof parsed.hash === 'string' &&
        Array.isArray(parsed.nodes) &&
        // 节点 shape 校验：weight 缺失/非数字的半写坏行过滤掉——
        // 否则进化页 n.weight.toFixed(2) 抛 TypeError 整页白屏
        parsed.nodes.every(
          (n) =>
            typeof n === 'object' &&
            n !== null &&
            typeof (n as { id?: unknown }).id === 'string' &&
            typeof (n as { weight?: unknown }).weight === 'number',
        )
      ) {
        snapshots.push({
          timestamp: parsed.timestamp,
          hash: parsed.hash,
          entropy: typeof parsed.entropy === 'number' ? parsed.entropy : 0,
          nodes: parsed.nodes,
          ...(typeof parsed.source === 'string' ? { source: parsed.source } : {}),
        });
      }
    } catch {
      // 坏行跳过（单条损坏不掩盖整体）
    }
  }
  return snapshots;
}

/** 追加一条快照到历史（与 agent recordInterestSnapshot 同语义：
 * O_APPEND 单行原子追加——整文件重写会与 agent 并发 append 竞态丢行） */
async function appendSnapshot(dir: string, snapshot: Snapshot): Promise<void> {
  await appendFile(join(dir, 'interest-history.jsonl'), JSON.stringify(snapshot) + '\n', 'utf-8');
}

/** 生成快照 hash（确定性：内容摘要，用于引用/回滚定位；16 位 = sha256 截断） */
function hashSnapshot(timestamp: string, nodes: Array<Record<string, unknown>>): string {
  return createHash('sha256').update(timestamp + JSON.stringify(nodes)).digest('hex').slice(0, 16);
}

export function createEvolutionRoutes({ config }: EvolutionDeps): Hono {
  const app = new Hono();

  /** GET /api/evolution — 快照序列 + 反馈事件 + 游荡摘要 */
  app.get('/', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const { dir } = scoped;

    const snapshots = await readSnapshots(dir);

    let feedbacks: unknown[] = [];
    try {
      const content = await readFile(join(dir, 'feedback.json'), 'utf-8');
      const parsed = JSON.parse(content) as { feedbacks?: unknown[] };
      feedbacks = Array.isArray(parsed.feedbacks) ? parsed.feedbacks : [];
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }

    let summary = { totalWanders: 0, totalPushes: 0 };
    try {
      const content = await readFile(join(dir, 'state.json'), 'utf-8');
      const parsed = JSON.parse(content) as {
        totalWanders?: unknown;
        totalPushes?: unknown;
      };
      summary = {
        totalWanders: typeof parsed.totalWanders === 'number' ? parsed.totalWanders : 0,
        totalPushes: typeof parsed.totalPushes === 'number' ? parsed.totalPushes : 0,
      };
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }

    return c.json({ success: true, data: { snapshots, feedbacks, summary } });
  });

  /** POST /api/evolution/rollback — 回滚到指定快照（限本租户历史） */
  app.post('/rollback', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const { dir, tenantId } = scoped;

    let body: { hash?: unknown };
    try {
      body = (await c.req.json()) as { hash?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const hash = body.hash;
    // agent 快照 hash 为 8 位 hex（DJB2，interest-history.ts computeHash）；
    // CP 回滚快照为 16 位 hex（sha256 截断）。两者都接受——按原文精确查找
    if (typeof hash !== 'string' || !/^[0-9a-f]{8,16}$/.test(hash)) {
      return c.json(jsonError('hash 须为 8-16 位 hex'), 400);
    }

    const snapshots = await readSnapshots(dir);
    const target = snapshots.find((s) => s.hash === hash);
    if (!target) {
      // 本租户无此快照（含他租户 hash）：统一 404，不暴露存在性
      return c.json(jsonError('快照不存在'), 404);
    }

    // 还原 interests.json（agent InterestGraphData schema：version/lastUpdated/nodes）
    const restored = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      nodes: target.nodes.map((n) => ({
        id: String(n.id),
        weight: typeof n.weight === 'number' ? n.weight : 0,
        source: typeof n.source === 'string' ? n.source : 'default',
        createdAt: typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString(),
        lastReinforced:
          typeof n.lastReinforced === 'string' ? n.lastReinforced : new Date().toISOString(),
        reinforceCount: typeof n.reinforceCount === 'number' ? n.reinforceCount : 0,
      })),
    };
    const interestsFile = join(dir, 'interests.json');
    const tmp = `${interestsFile}.tmp-${randomUUID().slice(0, 8)}`;
    await writeFile(tmp, JSON.stringify(restored, null, 2));
    await rename(tmp, interestsFile);

    // 追加回滚快照（可追溯：source=rollback，指向被回滚到的 hash）
    const now = new Date().toISOString();
    const rollbackSnapshot: Snapshot = {
      timestamp: now,
      hash: hashSnapshot(now, target.nodes),
      entropy: target.entropy,
      source: 'rollback',
      nodes: target.nodes,
    };
    await appendSnapshot(dir, rollbackSnapshot);

    return c.json({
      success: true,
      data: { tenantId, rolledBackTo: hash, snapshot: rollbackSnapshot },
    });
  });

  return app;
}
