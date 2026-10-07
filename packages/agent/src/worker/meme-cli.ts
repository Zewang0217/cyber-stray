/** 受控的租户表情包验证入口：preflight 只读；generate 走正式生图/质检/配额/用量管线。 */
import { fileURLToPath } from 'node:url';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { z } from 'zod';
import { getMemeImageUrl } from '@cyber-stray/shared/push';
import { getConfig, loadConfig, setTenantContext } from '../config.js';
import { createMemePipelineDeps, resolveMemeModelConfig } from '../meme/factory.js';
import { createMemeCopyRunner } from '../meme/copy-runner.js';
import { runMemePipeline } from '../meme/pipeline.js';
import { preparePetMemeReference, resolvePetReference } from '../meme/reference.js';
import { localDateKey, memeQuotaRemaining } from '../meme/quota.js';
import { recordMemeForPush } from '../meme/push.js';
import { loadManifest, memeFileName } from '../meme/storage.js';
import { assertUsageHealthy, assertUsageReady } from '../usage/usage.js';
import { assertTenantDataDir } from './tenant-dir.js';

const ArgsSchema = z.object({
  tenantId: z.string().min(1),
  dataDir: z.string().min(1),
  topic: z.string().trim().min(1).max(60).optional(),
  petName: z.string().trim().min(1).optional(),
});
// 文案 60s + Seedream 120s + 叠字 60s + 思考视觉 QC 90s，留 30s 落盘余量。
const MEME_GENERATE_TIMEOUT_MS = 360_000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

/** 只发布本租户 QC 已通过的 IP 图片；重试不会重复写入墙卡。 */
export async function publishRecordedMeme(dataDir: string, id: string): Promise<'published' | 'already-published'> {
  if (!getMemeImageUrl(id)) throw new Error('表情包 ID 格式无效');
  const meta = (await loadManifest(dataDir)).find((item) => item.id === id);
  if (!meta || !meta.qcPass || meta.mode !== 'ip' || meta.file !== memeFileName(id)) {
    throw new Error('本租户没有已通过质检的 IP 表情包');
  }
  await access(join(dataDir, 'meme-assets', meta.file));
  const historyDir = join(dataDir, 'history');
  let files: string[];
  try {
    files = await readdir(historyDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    files = [];
  }
  for (const file of files.filter((name) => /^speaks-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))) {
    const history = await readFile(join(historyDir, file), 'utf8');
    for (const line of history.split('\n').filter(Boolean)) {
      const record: unknown = JSON.parse(line);
      if (typeof record === 'object' && record !== null && Reflect.get(record, 'memeId') === id) {
        return 'already-published';
      }
    }
  }
  await recordMemeForPush(meta, { notify: false });
  return 'published';
}

async function main(): Promise<void> {
  const args = ArgsSchema.parse({
    tenantId: arg('tenant'), dataDir: arg('data-dir'), topic: arg('topic'), petName: arg('pet-name'),
  });
  const preflight = process.argv.includes('--preflight');
  const generate = process.argv.includes('--generate');
  const publishId = arg('publish-recorded');
  const publish = process.argv.includes('--publish');
  if (Number(preflight) + Number(generate) + Number(Boolean(publishId)) !== 1 || (publish && !generate)) {
    throw new Error('必须指定 --preflight、--generate [--publish] 或 --publish-recorded ID');
  }
  args.dataDir = await assertTenantDataDir(args.tenantId, args.dataDir);

  const config = loadConfig(args.dataDir);
  setTenantContext({ tenantId: args.tenantId, dataDir: args.dataDir, config });
  try {
    if (publishId) {
      const status = await publishRecordedMeme(args.dataDir, publishId);
      process.stdout.write(`${JSON.stringify({ status, id: publishId, imageUrl: getMemeImageUrl(publishId) })}\n`);
      return;
    }
    if (!args.topic || !args.petName) throw new Error('preflight/generate 需要 --topic 与 --pet-name');
    const reference = await resolvePetReference(args.dataDir);
    if (!reference) throw new Error('当前租户没有已交付的宠物形象');
    const deps = createMemePipelineDeps(args.dataDir);
    const models = resolveMemeModelConfig();
    const remaining = await memeQuotaRemaining(args.dataDir, deps.dailyLimit, localDateKey());
    if (remaining <= 0) throw new Error('今日表情包配额已用完');
    assertUsageReady(args.dataDir, models.imageModel, 'image');
    assertUsageReady(args.dataDir, models.visionModel, 'vision_qc');
    assertUsageReady(args.dataDir, config.llmModel, 'llm');
    const apiKey = getConfig().secrets?.deepseekApiKey;
    if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY');
    if (preflight) {
      process.stdout.write(`${JSON.stringify({ ready: true, tenantId: args.tenantId, remaining,
        imageModel: models.imageModel, visionModel: models.visionModel,
        visionThinking: models.visionThinking })}\n`);
      return;
    }
    const prepared = await preparePetMemeReference(args.dataDir);
    if (!prepared) throw new Error('宠物角色参考图在生成前消失');
    const model = createDeepSeek({ apiKey }).chat(config.llmModel);
    const copy = createMemeCopyRunner({ petName: args.petName, personalityName: config.personality, model });
    const startedAt = Date.now();
    const result = await runMemePipeline(deps, {
      topic: args.topic, mode: 'ip', referencePath: prepared.path, petSpecText: prepared.specText,
      abortSignal: AbortSignal.timeout(MEME_GENERATE_TIMEOUT_MS),
    }, copy);
    assertUsageHealthy(args.dataDir);
    process.stdout.write(`${JSON.stringify(result.status === 'recorded'
      ? { status: 'recorded', id: result.meta.id, imageUrl: getMemeImageUrl(result.meta.id),
        elapsedMs: Date.now() - startedAt }
      : { ...result, elapsedMs: Date.now() - startedAt })}\n`);
    if (result.status !== 'recorded') process.exitCode = 1;
    if (publish && result.status === 'recorded') {
      const status = await publishRecordedMeme(args.dataDir, result.meta.id);
      process.stdout.write(`${JSON.stringify({ status, id: result.meta.id })}\n`);
    }
  } finally {
    setTenantContext(null);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
