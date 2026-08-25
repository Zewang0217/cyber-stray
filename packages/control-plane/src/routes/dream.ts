/**
 * dream 路由 — /api/dream（#93 梦境系统）
 *
 * 暴露租户的当晚梦境（diary/dreams/YYYY-MM-DD.md，文件系统 markdown 契约；
 * ADR-0002：梦境与日记分离，睡前任务与日记同刻预生成，夜间访问零延迟读取）：
 * - GET /api/dream         梦境列表（时间倒序：date/title/excerpt）
 * - GET /api/dream/:date   单篇梦境（date/content）
 *
 * 租户隔离与 diary/footprint/data 同规矩：session claim 定租户，x-tenant-* 忽略。
 * 缺失 = 合法空态（200 空列表 / 404）；损坏 = 显式 500（禁兜底）。
 */

import { Hono } from 'hono';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface DreamDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 梦境日期合法性（YYYY-MM-DD，防路径穿越） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 单篇梦境（列表项与单篇共用核心字段） */
export interface DreamEntry {
  date: string;
  title: string;
  content: string;
  excerpt?: string;
}

/** 解析梦境标题：取首个 `# ` 一级标题；缺省回退 '梦境' */
function parseTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : '梦境';
}

/** 摘录：去掉 markdown 装饰后的前 120 字 */
function excerpt(content: string, maxChars = 120): string {
  const plain = content
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>]|\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxChars ? `${plain.slice(0, maxChars)}…` : plain;
}

/** 鉴权 + 租户校验：401 / 403 / { dir }（与 diary 同规矩） */
async function scopedTenant(
  req: Request,
  config: DreamDeps['config'],
): Promise<{ dir: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };
  const db = await getDb(config.dataDir);
  const relation = await db
    .select()
    .from(userTenants)
    .where(
      and(eq(userTenants.userId, session.sub), eq(userTenants.tenantId, session.tenantId)),
    )
    .get();
  if (!relation) return { error: 403 };
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };
  return { dir: tenantDataDir(config.dataDir, session.tenantId) };
}

export function createDreamRoutes({ config }: DreamDeps): Hono {
  const app = new Hono();

  /** GET /api/dream — 梦境列表（时间倒序，含标题/摘录） */
  app.get('/', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    const dreamsDir = join(scoped.dir, 'diary', 'dreams');
    let files: string[];
    try {
      files = (await readdir(dreamsDir)).filter((f) => f.endsWith('.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ success: true, data: [] });
      }
      throw error;
    }

    const entries: DreamEntry[] = [];
    for (const file of files) {
      const date = file.slice(0, -3); // 去 .md 后缀
      if (!DATE_RE.test(date)) continue; // 非日期命名的 md 不当作梦境
      try {
        const content = await readFile(join(dreamsDir, file), 'utf-8');
        entries.push({ date, title: parseTitle(content), content, excerpt: excerpt(content) });
      } catch (error) {
        console.error(`[dream] 读取 ${file} 失败：`, error);
        return c.json(jsonError('梦境数据损坏或不可读'), 500);
      }
    }
    entries.sort((a, b) => (a.date < b.date ? 1 : -1)); // 时间倒序
    return c.json({ success: true, data: entries });
  });

  /** GET /api/dream/:date — 单篇梦境（YYYY-MM-DD） */
  app.get('/:date', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) {
      return c.json(jsonError('date 须为 YYYY-MM-DD'), 400);
    }

    let content: string;
    try {
      content = await readFile(join(scoped.dir, 'diary', 'dreams', `${date}.md`), 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json(jsonError('该日期没有梦境'), 404);
      }
      throw error;
    }
    return c.json({
      success: true,
      data: { date, title: parseTitle(content), content },
    });
  });

  return app;
}
