/**
 * feedback CLI — S9 REST 反馈的短命 worker 入口（issue #76）
 *
 * 用法：
 *   tsx src/worker/feedback-cli.ts --data-dir <dir> --action feedback \
 *     --type like|dislike --message-id <id> [--user-id <id>]
 *   tsx src/worker/feedback-cli.ts --data-dir <dir> --action boost \
 *     --topic <话题> [--user-id <id>]
 *
 * 由控制面 /api/feedback 与 /api/boost 路由 spawn（同 worker 模式）。
 * 反馈处理不需要 LLM/secrets——只落 feedback.json、用户画像、兴趣图谱。
 *
 * 归因：worker 短命进程没有 speak 时的内存 messageId→topics 映射，
 * 从 speaks-*.jsonl 历史按 messageId 反查 S9 落盘的 matchedTopics。
 *
 * 退出码：0 = 处理完成；1 = 处理失败；2 = 参数错误。
 * stdout 一行 JSON（{ ok, result }）；失败时 stderr 一行 JSON。
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { loadConfig, setTenantContext } from '../config.js';
import { parseCatchphraseList, type Catchphrase } from '@cyber-stray/shared';
import { processFeedback, boostTopic } from '../memory/feedback-pipeline.js';
import type { FeedbackProcessResult } from '../memory/feedback-pipeline.js';

/** runFeedbackWorker 入参（CLI 参数解析后的结构化形态） */
export interface FeedbackWorkerOptions {
  /** 租户数据目录（= DATA_DIR） */
  dataDir: string;
  action: 'feedback' | 'boost';
  /** action=feedback：反馈类型 */
  type?: 'like' | 'dislike';
  /** action=feedback：推送消息 ID（归因键） */
  messageId?: string;
  /** action=boost：要顶的话题 */
  topic?: string;
  userId?: string;
  /** 宠物当前口头禅集合 JSON（#114：控制面从 pets 行注入——归因权重要落在
   * 真实集合上,不传则 loadConfig 回退性格默认组） */
  catchphrases?: Catchphrase[];
}

/**
 * 从 speaks-*.jsonl 历史按 messageId 反查 matchedTopics。
 *
 * 文件按日期命名（speaks-YYYY-MM-DD.jsonl），倒序扫描（最新优先），
 * 每文件内也倒序（同日消息追加在尾部）。找不到/无话题 → null。
 * 目录或文件缺失 = 合法空态（租户尚未游荡），返回 null 不报错。
 */
export async function resolveTopicsFromHistory(
  dataDir: string,
  messageId: string,
): Promise<string[] | null> {
  const record = await findSpeakRecord(dataDir, messageId);
  const topics = record?.matchedTopics ?? [];
  return topics.length > 0 ? topics : null;
}

/** 按 messageId 反查该 speak 用过的口头禅文本（#114 归因；无记录/未命中 null） */
export async function resolveCatchphrasesFromHistory(
  dataDir: string,
  messageId: string,
): Promise<string[] | null> {
  const record = await findSpeakRecord(dataDir, messageId);
  const phrases = record?.matchedCatchphrases ?? [];
  return phrases.length > 0 ? phrases : null;
}

/** speaks 历史按 messageId 反查整条记录（归因数据的持久化入口） */
async function findSpeakRecord(
  dataDir: string,
  messageId: string,
): Promise<{ matchedTopics?: string[]; matchedCatchphrases?: string[] } | null> {
  const historyDir = join(dataDir, 'history');
  let files: string[];
  try {
    files = (await readdir(historyDir)).filter(
      (f) => f.startsWith('speaks-') && f.endsWith('.jsonl'),
    );
  } catch (error) {
    // 目录不存在 = 合法空态（租户未游荡）；其他读错误显式抛（禁兜底）
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  files.sort().reverse();

  for (const file of files) {
    const content = await readFile(join(historyDir, file), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let record: Record<string, unknown>;
      try {
        const line = lines[i];
        if (!line) continue;
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // 单行损坏跳过
      }
      if (record.messageId !== messageId) continue;
      return {
        matchedTopics: Array.isArray(record.matchedTopics)
          ? record.matchedTopics.filter((t): t is string => typeof t === 'string' && t.length > 0)
          : [],
        matchedCatchphrases: Array.isArray(record.matchedCatchphrases)
          ? record.matchedCatchphrases.filter((t): t is string => typeof t === 'string' && t.length > 0)
          : [],
      };
    }
  }
  return null;
}

/**
 * 执行一次反馈处理（设置租户上下文 → 管道 → 清除上下文）。
 * 失败抛错（不兜底），CLI 层转退出码。
 */
export async function runFeedbackWorker(options: FeedbackWorkerOptions): Promise<FeedbackProcessResult> {
  const { dataDir } = options;

  if (options.action === 'feedback') {
    if (options.type !== 'like' && options.type !== 'dislike') {
      throw new Error('action=feedback 需要 --type like|dislike');
    }
    if (!options.messageId) {
      throw new Error('action=feedback 需要 --message-id');
    }
    // 归因优先走持久化历史（worker 进程无内存映射）
    const topics = (await resolveTopicsFromHistory(dataDir, options.messageId)) ?? undefined;
    const matchedPhrases =
      (await resolveCatchphrasesFromHistory(dataDir, options.messageId)) ?? undefined;
    setTenantContext({
      tenantId: 'feedback-worker',
      dataDir,
      config: loadConfig(dataDir, undefined, undefined, undefined, options.catchphrases),
    });
    try {
      return await processFeedback(options.type, options.messageId, options.userId, {
        topics,
        catchphrases: matchedPhrases,
      });
    } finally {
      setTenantContext(null);
    }
  }

  // boost
  if (!options.topic) {
    throw new Error('action=boost 需要 --topic');
  }
  setTenantContext({ tenantId: 'feedback-worker', dataDir, config: loadConfig(dataDir) });
  try {
    return await boostTopic(options.topic, options.userId);
  } finally {
    setTenantContext(null);
  }
}

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const dataDir = parseArg('data-dir');
  const action = parseArg('action');
  if (!dataDir || (action !== 'feedback' && action !== 'boost')) {
    console.error(
      '用法: tsx src/worker/feedback-cli.ts --data-dir <dir> --action feedback|boost [...]',
    );
    process.exit(2);
  }
  const type = parseArg('type') as 'like' | 'dislike' | undefined;
  if (action === 'feedback' && type !== 'like' && type !== 'dislike') {
    console.error('--type 必须是 like 或 dislike');
    process.exit(2);
  }
  // #114：控制面注入宠物当前口头禅集合（JSON 数组）；与 wander cli.ts
  // 同样的 JSON.parse 防护——非 JSON 显式 exit 2 而非静默降级为英文 502
  const catchphrasesRaw = parseArg('catchphrases');
  let catchphrases: Catchphrase[] | undefined;
  if (catchphrasesRaw !== undefined) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(catchphrasesRaw);
    } catch {
      console.error(JSON.stringify({ ok: false, error: '--catchphrases 须为 JSON 数组' }));
      process.exit(2);
    }
    const parsed = parseCatchphraseList(parsedJson);
    if (typeof parsed === 'string') {
      console.error(JSON.stringify({ ok: false, error: parsed }));
      process.exit(2);
    }
    catchphrases = parsed;
  }

  const result = await runFeedbackWorker({
    dataDir,
    action,
    type,
    messageId: parseArg('message-id'),
    topic: parseArg('topic'),
    userId: parseArg('user-id'),
    catchphrases,
  });
  // S9 review 修复：配额语义以兴趣强化为准——pipeline 未来若回归吞错，
  // 这里兜底：boost 未强化 / feedback 未记录 = 核心承诺未兑现，exit 1
  // （控制面路由按 exitCode 回滚 lastBoostAt 配额）
  if (action === 'boost' && !result.interestReinforced) {
    console.error(JSON.stringify({ ok: false, error: '兴趣未强化（图谱持久化失败）' }));
    process.exit(1);
  }
  if (action === 'feedback' && !result.recorded) {
    console.error(JSON.stringify({ ok: false, error: '反馈未记录' }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, result }));
  process.exit(0);
}

// 直接执行（非被 import）时跑 main
if (process.argv[1]?.endsWith('feedback-cli.ts')) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
}
