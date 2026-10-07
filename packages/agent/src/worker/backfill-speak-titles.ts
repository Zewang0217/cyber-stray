/**
 * 旧 article/share 标题补全：先生成可审阅计划，再按源文件 hash 原子应用。
 * 一次只处理一个租户的一天历史，保留正文、ID、渠道反馈别名和其余全部字段。
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText } from 'ai';
import { z } from 'zod';
import { loadConfig, setTenantContext } from '../config.js';
import { deriveTitle } from '../tools/push/history-record.js';
import { assertUsageReady, recordUsage } from '../usage/usage.js';
import { localDateKey } from '../meme/quota.js';
import { assertTenantDataDir } from './tenant-dir.js';
import { IndependentTitleSchema, TitleOverridesSchema } from '@cyber-stray/shared/title-overrides';

const HISTORY_FILE_RE = /^speaks-\d{4}-\d{2}-\d{2}\.jsonl$/;
const BATCH_SIZE = 5;
const MAX_RECORDS = 20;
const MAX_CONTENT_CHARS = 6_000;
const TitleSchema = IndependentTitleSchema;
const TitlesSchema = z.object({ titles: z.array(z.object({ index: z.number().int(), title: TitleSchema })) });
const PlanSchema = z.object({
  tenantId: z.string().min(1),
  historyFile: z.string().regex(HISTORY_FILE_RE),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  changes: z.array(z.object({ line: z.number().int().nonnegative(), oldTitle: z.string(),
    excerpt: z.string().min(1), title: TitleSchema })),
});
const OverlayPlanSchema = PlanSchema.omit({ changes: true }).extend({
  mode: z.literal('overlay'),
  sourceLength: z.number().int().nonnegative(),
  changes: z.array(z.object({
    line: z.number().int().nonnegative(), contentId: z.uuid(),
    sourceType: z.enum(['article', 'share']),
    timestamp: z.string().min(1), contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    oldTitle: z.string(), excerpt: z.string().min(1), title: TitleSchema,
  })).max(MAX_RECORDS),
});

type Candidate = { line: number; type: 'article' | 'share'; content: string; oldTitle: string };
type TitlePlan = z.infer<typeof PlanSchema>;
type OverlayPlan = z.infer<typeof OverlayPlanSchema>;
type TitleGenerator = (candidates: Candidate[]) => Promise<string[]>;

function historyPath(dataDir: string, historyFile: string): string {
  if (!HISTORY_FILE_RE.test(historyFile) || basename(historyFile) !== historyFile) {
    throw new Error('history-file 必须是 speaks-YYYY-MM-DD.jsonl 文件名');
  }
  if (historyFile >= `speaks-${localDateKey()}.jsonl`) {
    throw new Error('标题补全仅允许已结束的历史日期，避免与当前写入并发');
  }
  return join(dataDir, 'history', historyFile);
}

function currentHistoryPath(dataDir: string, historyFile: string): string {
  if (historyFile !== `speaks-${localDateKey()}.jsonl`) {
    throw new Error('--overlay 仅允许当前日期的 speaks JSONL');
  }
  return join(dataDir, 'history', historyFile);
}

function overlayPath(dataDir: string): string {
  return join(dataDir, 'history', 'title-overrides.json');
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function needsIndependentTitle(value: unknown): value is 'article' | 'share' {
  return value === 'article' || value === 'share';
}

function candidatesFromLines(lines: string[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [line, text] of lines.entries()) {
    if (!text.trim()) continue;
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) throw new Error(`历史第 ${line + 1} 行不是对象`);
    const item = raw as Record<string, unknown>;
    if (!needsIndependentTitle(item.type) || item.diary || item.meme || item.titleSource !== undefined) continue;
    if (typeof item.content !== 'string' || !item.content.trim()) continue;
    const oldTitle = typeof item.title === 'string' ? item.title : '';
    if (oldTitle && oldTitle !== deriveTitle(item.content, item.type)) continue;
    candidates.push({ line, type: item.type, content: item.content, oldTitle });
  }
  return candidates;
}

/** 只读历史并生成计划；超出单次上限时失败，不静默遗漏。 */
export async function createTitlePlan(
  dataDir: string, tenantId: string, historyFile: string, generateTitles: TitleGenerator,
): Promise<TitlePlan> {
  const source = await readFile(historyPath(dataDir, historyFile), 'utf8');
  const candidates = candidatesFromLines(source.split('\n'));
  if (candidates.length > MAX_RECORDS) throw new Error(`候选 ${candidates.length} 条超过单次上限 ${MAX_RECORDS}`);
  const changes: TitlePlan['changes'] = [];
  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE);
    const titles = await generateTitles(batch);
    if (titles.length !== batch.length) throw new Error('模型返回标题数与候选数不一致');
    for (const [index, candidate] of batch.entries()) {
      changes.push({ line: candidate!.line, oldTitle: candidate!.oldTitle,
        excerpt: [...candidate!.content].slice(0, 160).join(''),
        title: TitleSchema.parse(titles[index]) });
    }
  }
  return { tenantId, historyFile, sourceSha256: sha256(source), changes };
}

/** 当天只生成 sidecar 计划；候选缺稳定 UUID 整批拒绝，不猜反馈 ID。 */
export async function createOverlayTitlePlan(
  dataDir: string, tenantId: string, historyFile: string, generateTitles: TitleGenerator,
): Promise<OverlayPlan> {
  const source = await readFile(currentHistoryPath(dataDir, historyFile), 'utf8');
  const lines = source.split('\n');
  const candidates = candidatesFromLines(lines);
  if (candidates.length > MAX_RECORDS) throw new Error(`候选 ${candidates.length} 条超过单次上限 ${MAX_RECORDS}`);
  const identities = candidates.map((candidate) => {
    const raw: unknown = JSON.parse(lines[candidate.line]!);
    const item = raw as Record<string, unknown>;
    const contentId = z.uuid().safeParse(item.contentId);
    if (!contentId.success || typeof item.timestamp !== 'string' || !item.timestamp) {
      throw new Error(`历史第 ${candidate.line + 1} 行缺稳定 contentId UUID 或 timestamp`);
    }
    return { contentId: contentId.data, timestamp: item.timestamp,
      contentSha256: sha256(candidate.content) };
  });
  if (new Set(identities.map((identity) => identity.contentId)).size !== identities.length) {
    throw new Error('当天历史候选 contentId 重复');
  }
  const changes: OverlayPlan['changes'] = [];
  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE);
    const titles = await generateTitles(batch);
    if (titles.length !== batch.length) throw new Error('模型返回标题数与候选数不一致');
    for (const [index, candidate] of batch.entries()) {
      changes.push({ line: candidate!.line, sourceType: candidate!.type, ...identities[start + index]!,
        oldTitle: candidate!.oldTitle, excerpt: [...candidate!.content].slice(0, 160).join(''),
        title: TitleSchema.parse(titles[index]) });
    }
  }
  return { mode: 'overlay', tenantId, historyFile, sourceSha256: sha256(source),
    sourceLength: source.length, changes };
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}

/** 仅在源文件与审阅时完全相同时应用计划；整日历史一次 rename 提交。 */
export async function applyTitlePlan(dataDir: string, tenantId: string, rawPlan: unknown): Promise<number> {
  const plan = PlanSchema.parse(rawPlan);
  if (plan.tenantId !== tenantId) throw new Error('标题计划的租户不匹配');
  const path = historyPath(dataDir, plan.historyFile);
  const source = await readFile(path, 'utf8');
  if (sha256(source) !== plan.sourceSha256) throw new Error('历史文件自 dry-run 后已变化，拒绝应用旧计划');
  const lines = source.split('\n');
  const seen = new Set<number>();
  for (const change of plan.changes) {
    if (seen.has(change.line)) throw new Error(`标题计划重复行 ${change.line}`);
    seen.add(change.line);
    const text = lines[change.line];
    if (!text) throw new Error(`标题计划行 ${change.line} 不存在`);
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) throw new Error(`历史第 ${change.line + 1} 行不是对象`);
    const item = raw as Record<string, unknown>;
    if (!needsIndependentTitle(item.type) || item.diary || item.meme || item.titleSource ||
        typeof item.content !== 'string' ||
        (typeof item.title === 'string' ? item.title : '') !== change.oldTitle ||
        (change.oldTitle && change.oldTitle !== deriveTitle(item.content, item.type)) ||
        [...item.content].slice(0, 160).join('') !== change.excerpt) {
      throw new Error(`标题计划第 ${change.line + 1} 行不再符合旧内容条件`);
    }
    lines[change.line] = JSON.stringify({ ...item, title: change.title, titleSource: 'backfill' });
  }
  if (plan.changes.length > 0) await writeAtomically(path, lines.join('\n'));
  return plan.changes.length;
}

/** 当前日只原子更新 sidecar；允许 JSONL 追加，但所有计划来源必须仍一致。 */
export async function applyOverlayTitlePlan(
  dataDir: string, tenantId: string, rawPlan: unknown,
): Promise<number> {
  const plan = OverlayPlanSchema.parse(rawPlan);
  if (plan.tenantId !== tenantId) throw new Error('标题计划的租户不匹配');
  const source = await readFile(currentHistoryPath(dataDir, plan.historyFile), 'utf8');
  if (source.length < plan.sourceLength ||
      sha256(source.slice(0, plan.sourceLength)) !== plan.sourceSha256) {
    throw new Error('当天历史前缀自 dry-run 后已变化，仅允许追加新记录');
  }
  const records = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const line of source.split('\n').filter(Boolean)) {
    const raw: unknown = JSON.parse(line);
    if (typeof raw !== 'object' || raw === null) throw new Error('当天历史行不是对象');
    const item = raw as Record<string, unknown>;
    if (typeof item.contentId !== 'string') continue;
    if (records.has(item.contentId)) throw new Error(`当天历史 contentId 重复: ${item.contentId}`);
    records.set(item.contentId, item);
  }
  const entries = await readTitleOverrides(dataDir);
  for (const change of plan.changes) {
    if (seen.has(change.contentId)) throw new Error(`标题计划 contentId 重复: ${change.contentId}`);
    seen.add(change.contentId);
    const item = records.get(change.contentId);
    if (!item || item.type !== change.sourceType || item.diary || item.meme ||
        item.titleSource !== undefined ||
        typeof item.content !== 'string' || item.timestamp !== change.timestamp ||
        sha256(item.content) !== change.contentSha256 ||
        (typeof item.title === 'string' ? item.title : '') !== change.oldTitle ||
        (change.oldTitle && change.oldTitle !== deriveTitle(item.content, change.sourceType)) ||
        [...item.content].slice(0, 160).join('') !== change.excerpt) {
      throw new Error(`标题覆盖来源不一致: ${change.contentId}`);
    }
    const next = { title: change.title, sourceType: change.sourceType,
      oldTitle: change.oldTitle, titleSourceAbsent: true as const, timestamp: change.timestamp,
      contentSha256: change.contentSha256 };
    const previous = entries[change.contentId];
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) {
      throw new Error(`标题覆盖已有冲突: ${change.contentId}`);
    }
    entries[change.contentId] = next;
  }
  const overlay = TitleOverridesSchema.parse({ version: 1, entries });
  if (plan.changes.length > 0) await writeAtomically(overlayPath(dataDir), JSON.stringify(overlay, null, 2));
  return plan.changes.length;
}

async function readTitleOverrides(dataDir: string): Promise<z.infer<typeof TitleOverridesSchema>['entries']> {
  try {
    const raw: unknown = JSON.parse(await readFile(overlayPath(dataDir), 'utf8'));
    return TitleOverridesSchema.parse(raw).entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function generateTitlesWithModel(dataDir: string, tenantId: string): Promise<TitleGenerator> {
  const config = loadConfig(dataDir);
  const apiKey = config.secrets?.deepseekApiKey;
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY，无法补全旧标题');
  const model = createDeepSeek({ apiKey }).chat(config.llmModel);
  setTenantContext({ tenantId, dataDir, config });
  return async (candidates) => {
    assertUsageReady(dataDir, config.llmModel, 'llm');
    const input = candidates.map((item, index) => ({
      index, type: item.type, content: [...item.content].slice(0, MAX_CONTENT_CHARS).join(''),
    }));
    const result = await generateText({
      model, temperature: 0.4, abortSignal: AbortSignal.timeout(60_000),
      prompt: `为以下文章或分享各写一个4-24字的中文短标题。标题要有吸引力、忠于正文事实，不能截取首句、夸张或编造。只输出 JSON {"titles":[{"index":0,"title":"..."}]}，索引必须完整且按顺序。\n${JSON.stringify(input)}`,
    });
    await recordUsage(dataDir, {
      kind: 'llm', model: config.llmModel,
      inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens,
    });
    const clean = result.text.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    const parsed = TitlesSchema.parse(JSON.parse(clean) as unknown);
    if (parsed.titles.length !== candidates.length ||
        parsed.titles.some((item, index) => item.index !== index)) {
      throw new Error('模型返回标题索引不完整或顺序错误');
    }
    return parsed.titles.map((item) => item.title);
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const dataDir = arg('data-dir');
  const tenantId = arg('tenant');
  const historyFile = arg('history-file');
  const planFile = arg('plan-file');
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  const overlay = process.argv.includes('--overlay');
  if (!dataDir || !tenantId || !historyFile || !planFile || dryRun === apply) {
    throw new Error('用法: --tenant ID --data-dir DIR --history-file speaks-YYYY-MM-DD.jsonl --plan-file PATH (--dry-run | --apply) [--overlay]');
  }
  const tenantDir = await assertTenantDataDir(tenantId, dataDir);
  const target = overlay ? currentHistoryPath(tenantDir, historyFile) : historyPath(tenantDir, historyFile);
  if ([target, overlayPath(tenantDir)].some((path) => resolve(planFile) === resolve(path))) {
    throw new Error('plan-file 不能覆盖历史文件或标题覆盖文件');
  }
  if (dryRun) {
    const generateTitles = await generateTitlesWithModel(tenantDir, tenantId);
    try {
      const plan = overlay
        ? await createOverlayTitlePlan(tenantDir, tenantId, historyFile, generateTitles)
        : await createTitlePlan(tenantDir, tenantId, historyFile, generateTitles);
      await writeAtomically(planFile, JSON.stringify(plan, null, 2));
      process.stdout.write(`${JSON.stringify({ planFile, count: plan.changes.length, changes: plan.changes })}\n`);
    } finally {
      setTenantContext(null);
    }
    return;
  }
  const plan: unknown = JSON.parse(await readFile(planFile, 'utf8'));
  const validated = overlay ? OverlayPlanSchema.parse(plan) : PlanSchema.parse(plan);
  if (validated.historyFile !== historyFile || (overlay && !('mode' in validated))) {
    throw new Error('标题计划的历史文件或模式不匹配');
  }
  const count = overlay
    ? await applyOverlayTitlePlan(tenantDir, tenantId, validated)
    : await applyTitlePlan(tenantDir, tenantId, validated);
  process.stdout.write(`${JSON.stringify({ applied: count, historyFile })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
