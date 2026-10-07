/**
 * 旧 article 标题补全：先生成可审阅计划，再按源文件 hash 原子应用。
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

const HISTORY_FILE_RE = /^speaks-\d{4}-\d{2}-\d{2}\.jsonl$/;
const BATCH_SIZE = 5;
const MAX_RECORDS = 20;
const MAX_CONTENT_CHARS = 6_000;
const TitleSchema = z.string().trim().min(4).max(24).refine((value) => !/[\r\n]/.test(value));
const TitlesSchema = z.object({ titles: z.array(z.object({ index: z.number().int(), title: TitleSchema })) });
const PlanSchema = z.object({
  tenantId: z.string().min(1),
  historyFile: z.string().regex(HISTORY_FILE_RE),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  changes: z.array(z.object({ line: z.number().int().nonnegative(), oldTitle: z.string(),
    excerpt: z.string().min(1), title: TitleSchema })),
});

type Candidate = { line: number; content: string; oldTitle: string };
type TitlePlan = z.infer<typeof PlanSchema>;
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

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function candidatesFromLines(lines: string[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [line, text] of lines.entries()) {
    if (!text.trim()) continue;
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) throw new Error(`历史第 ${line + 1} 行不是对象`);
    const item = raw as Record<string, unknown>;
    if (item.type !== 'article' || item.diary || item.meme || item.titleSource) continue;
    if (typeof item.content !== 'string' || !item.content.trim()) continue;
    const oldTitle = typeof item.title === 'string' ? item.title : '';
    if (oldTitle && oldTitle !== deriveTitle(item.content, 'article')) continue;
    candidates.push({ line, content: item.content, oldTitle });
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
    if (item.type !== 'article' || item.diary || item.meme || item.titleSource ||
        typeof item.content !== 'string' ||
        (typeof item.title === 'string' ? item.title : '') !== change.oldTitle ||
        (change.oldTitle && change.oldTitle !== deriveTitle(item.content, 'article')) ||
        [...item.content].slice(0, 160).join('') !== change.excerpt) {
      throw new Error(`标题计划第 ${change.line + 1} 行不再符合旧文章条件`);
    }
    lines[change.line] = JSON.stringify({ ...item, title: change.title, titleSource: 'backfill' });
  }
  if (plan.changes.length > 0) await writeAtomically(path, lines.join('\n'));
  return plan.changes.length;
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
      index, content: [...item.content].slice(0, MAX_CONTENT_CHARS).join(''),
    }));
    const result = await generateText({
      model, temperature: 0.4, abortSignal: AbortSignal.timeout(60_000),
      prompt: `为以下文章各写一个4-24字的中文短标题。标题要有吸引力、忠于正文事实，不能截取首句、夸张或编造。只输出 JSON {"titles":[{"index":0,"title":"..."}]}，索引必须完整且按顺序。\n${JSON.stringify(input)}`,
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
  if (!dataDir || !tenantId || !historyFile || !planFile || dryRun === apply) {
    throw new Error('用法: --tenant ID --data-dir DIR --history-file speaks-YYYY-MM-DD.jsonl --plan-file PATH (--dry-run | --apply)');
  }
  const tenantDir = await assertTenantDataDir(tenantId, dataDir);
  if (resolve(planFile) === resolve(historyPath(tenantDir, historyFile))) {
    throw new Error('plan-file 不能覆盖历史文件');
  }
  if (dryRun) {
    const generateTitles = await generateTitlesWithModel(tenantDir, tenantId);
    try {
      const plan = await createTitlePlan(tenantDir, tenantId, historyFile, generateTitles);
      await writeAtomically(planFile, JSON.stringify(plan, null, 2));
      process.stdout.write(`${JSON.stringify({ planFile, count: plan.changes.length, changes: plan.changes })}\n`);
    } finally {
      setTenantContext(null);
    }
    return;
  }
  const plan: unknown = JSON.parse(await readFile(planFile, 'utf8'));
  if (PlanSchema.parse(plan).historyFile !== historyFile) throw new Error('标题计划的历史文件不匹配');
  const count = await applyTitlePlan(tenantDir, tenantId, plan);
  process.stdout.write(`${JSON.stringify({ applied: count, historyFile })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
