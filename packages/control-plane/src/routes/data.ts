/**
 * data 路由 — /api/{state,interests,interests/history,history}（S6，#73）
 *
 * Web API 的租户化只读数据面：
 * - 鉴权：session cookie JWT（无/坏 → 401）；租户只由 session claim 决定
 *   （x-tenant-* header 一律忽略——安全硬规矩）
 * - 租户范围校验：claim 的 (sub, tenantId) 必须有 user_tenants 关系行（防
 *   过期/伪造 claim 越权），否则 403
 * - 数据路由：只读 tenants/<sub>/ 数据目录（web 只读契约：绝不写 agent 数据，
 *   字段解析规则只在 agent 侧；此处仅做展示层归一化，与旧 web 路由同逻辑）
 * - 响应 shape 与旧 web 路由一致（{success, data|error}）
 */

import { Hono } from 'hono';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';

export interface DataDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

/** 解析并校验租户：401（未登录）/ 403（关系行缺失）/ 数据目录 */
async function scopedTenant(
  req: Request,
  config: DataDeps['config'],
): Promise<{ dir: string; tenantId: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };

  // 租户范围校验：session claim 必须对应 user_tenants 既有关系
  const db = await getDb(config.dataDir);
  const relation = await db
    .select()
    .from(userTenants)
    .where(
      and(eq(userTenants.userId, session.sub), eq(userTenants.tenantId, session.tenantId)),
    )
    .get();
  if (!relation) return { error: 403 };
  // 路径拼接前校验（与 tenant-secrets 的 fs 边界同规矩：防注入）
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };

  return { dir: tenantDataDir(config.dataDir, session.tenantId), tenantId: session.tenantId };
}

/** 文件缺失（ENOENT）= 合法空态；其他读/解析错误必须显式抛（禁兜底） */
function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

const jsonError = (message: string) => ({ success: false, error: message });

export function createDataRoutes({ config }: DataDeps): Hono {
  const app = new Hono();

  /** GET /api/state — Agent 当前状态 */
  app.get('/state', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    try {
      const state = JSON.parse(await readFile(join(scoped.dir, 'state.json'), 'utf-8'));
      return c.json({ success: true, data: state });
    } catch (error) {
      if (isEnoent(error)) {
        // 租户尚未跑过游荡（无 state.json）→ 空态
        return c.json({ success: true, data: null });
      }
      // 文件损坏/不可读：显式报错（不吞成空态掩盖损坏）
      console.error('[data] state.json 读取失败：', error);
      return c.json(jsonError('状态数据损坏或不可读'), 500);
    }
  });

  /** GET /api/interests — 兴趣图谱 + Shannon 熵（公式与 agent getEntropy 同步） */
  app.get('/interests', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    let nodes: Array<{ weight: number }> = [];
    let lastUpdated: string | null = null;
    try {
      const data = JSON.parse(await readFile(join(scoped.dir, 'interests.json'), 'utf-8'));
      nodes = data.nodes ?? [];
      lastUpdated = data.lastUpdated ?? null;
    } catch (error) {
      if (!isEnoent(error)) {
        console.error('[data] interests.json 读取失败：', error);
        return c.json(jsonError('兴趣图谱数据损坏或不可读'), 500);
      }
      // 文件不存在 → 空数据（空态）
    }

    const weights = nodes.map((n) => n.weight).filter((w) => w > 0);
    let entropy = 0;
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total > 0) {
      for (const w of weights) {
        const p = w / total;
        if (p > 0) entropy -= p * Math.log2(p);
      }
    }

    return c.json({
      success: true,
      data: {
        nodes,
        entropy: Math.round(entropy * 1000) / 1000,
        nodeCount: nodes.length,
        lastUpdated,
      },
    });
  });

  /** GET /api/interests/history?limit=30 — 兴趣权重时间序列 */
  app.get('/interests/history', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100);
    const snapshots: unknown[] = [];
    try {
      const content = await readFile(join(scoped.dir, 'interest-history.jsonl'), 'utf-8');
      for (const line of content.trim().split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (
            typeof parsed.timestamp === 'string' &&
            Array.isArray(parsed.nodes) &&
            typeof parsed.entropy === 'number'
          ) {
            snapshots.push(parsed);
          }
        } catch {
          // 跳过非法行
        }
      }
    } catch (error) {
      if (!isEnoent(error)) {
        console.error('[data] interest-history.jsonl 读取失败：', error);
        return c.json(jsonError('兴趣历史数据损坏或不可读'), 500);
      }
      // 文件不存在 → 空数组
    }

    return c.json({ success: true, data: snapshots.slice(-limit) });
  });

  /** GET /api/history — 历史推送记录（JSONL 解析 + 展示层归一化，倒序；支持分页） */
  app.get('/history', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    // 分页（#123）：limit 默认 100 上限 200；offset 默认 0。不带参数 = 第一页。
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
    const historyDir = join(scoped.dir, 'history');
    let files: string[] = [];
    try {
      // 只扫 .jsonl（同目录可能有 pushed.json 等非历史文件）
      files = (await readdir(historyDir)).filter((f) => f.endsWith('.jsonl'));
    } catch (error) {
      if (!isEnoent(error)) {
        console.error('[data] history 目录读取失败：', error);
        return c.json(jsonError('历史目录不可读'), 500);
      }
      // 目录不存在 → 空历史（租户尚未游荡）
    }

    const items: Array<Record<string, unknown>> = [];
    for (const file of files.slice(-50)) {
      let content: string;
      try {
        content = await readFile(join(historyDir, file), 'utf-8');
      } catch (error) {
        // 仅 ENOENT（readdir 后被并发清理）合法跳过；其余显式抛（禁兜底）
        if (!isEnoent(error)) {
          console.error('[data] history 文件读取失败：', error);
          return c.json(jsonError('历史记录不可读'), 500);
        }
        continue;
      }
      items.push(...parseHistoryJsonl(content));
    }
    items.sort(
      (a, b) =>
        new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime(),
    );
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return c.json({
      success: true,
      data: page,
      pagination: { total, offset, limit, hasMore: offset + limit < total },
    });
  });

  return app;
}

// ─── history 展示层归一化（与旧 web 路由同规则；写入侧规则只在 agent） ──

const TITLE_MAX_CHARS = 40;
const SUMMARY_MAX_CHARS = 120;

const TYPE_LABELS: Record<string, string> = {
  share: '分享',
  nonsense: '碎碎念',
  article: '文章',
};

function stripDecoration(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars ? text : `${chars.slice(0, maxChars).join('')}…`;
}

/** 归一化一条记录（旧记录无 title/summary 时截断补齐；url/mood 由 agent 侧独占） */
function normalizeRecord(raw: Record<string, unknown>): Record<string, unknown> | null {
  const timestamp = raw.timestamp;
  if (typeof timestamp !== 'string') return null;

  const message = typeof raw.content === 'string' ? raw.content : '';
  const type = typeof raw.type === 'string' ? raw.type : undefined;
  const stripped = stripDecoration(message);
  const fallbackTitle = type ? (TYPE_LABELS[type] ?? '推送') : '推送';

  return {
    message,
    timestamp,
    title:
      typeof raw.title === 'string'
        ? raw.title
        : stripped
          ? truncate(stripped, TITLE_MAX_CHARS)
          : fallbackTitle,
    summary:
      typeof raw.summary === 'string' ? raw.summary : truncate(stripped, SUMMARY_MAX_CHARS),
    ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
    ...(typeof raw.mood === 'string' ? { mood: raw.mood } : {}),
    ...(type ? { type } : {}),
    ...(typeof raw.pushed === 'boolean' ? { pushed: raw.pushed } : {}),
    ...(raw.gated ? { gated: true } : {}),
    ...(Array.isArray(raw.gateReasons)
      ? { gateReasons: raw.gateReasons.filter((r): r is string => typeof r === 'string') }
      : {}),
    ...(typeof raw.messageId === 'string' ? { messageId: raw.messageId } : {}),
    ...(Array.isArray(raw.matchedTopics)
      ? { matchedTopics: raw.matchedTopics.filter((t): t is string => typeof t === 'string') }
      : {}),
  };
}

/** 解析 JSONL；单行损坏只跳过该行 */
function parseHistoryJsonl(content: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const line of content.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const normalized = normalizeRecord(JSON.parse(trimmed) as Record<string, unknown>);
      if (normalized) records.push(normalized);
    } catch {
      // 跳过损坏的单行
    }
  }
  return records;
}
