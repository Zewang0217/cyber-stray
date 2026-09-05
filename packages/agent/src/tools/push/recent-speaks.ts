/**
 * 最近推送上下文（S3 #152，去重 L2）
 *
 * 从 speak 历史 JSONL（今天 + 昨天）读取最近成功推送的记录，供推送判断
 * prompt 展示"最近已推过什么"——LLM 据此做语义级去重（同主题换来源也算
 * 重复）。确定性 URL 去重由 L1（url-tracker）承担，这里补语义层。
 *
 * 文件级顺序扫、只取尾部 N 条，量级小；文件缺失/单行损坏按 skip 处理
 * （与 countGatePassedToday 同语义：历史读取是观测路径，坏行不值得
 * 阻断整个游荡）。
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { getDataPath } from '../../config.js';
import { localDateKey, todaySpeaksFile } from './push-budget.js';
import type { SpeakRecord } from './history-record.js';

/** prompt 展示的最近推送条数上限（再多挤占上下文空间） */
export const RECENT_SPEAKS_PROMPT_LIMIT = 8;

/** 回看天数：speaks 文件按本地日分割，今天 + 昨天覆盖"最近"语义 */
const RECENT_SPEAKS_LOOKBACK_DAYS = 1;

/** 最近推送记录（prompt 展示所需字段） */
export interface RecentSpeak {
  title: string;
  summary: string;
  timestamp: string;
}

/**
 * 加载最近成功推送的 speak 记录（最新在前）。
 * pushed=true 且非 gated/planLimited 的记录才算"已推送给主人"。
 */
export async function loadRecentPushedSpeaks(
  limit: number = RECENT_SPEAKS_PROMPT_LIMIT,
): Promise<RecentSpeak[]> {
  const files: string[] = [];
  for (let d = 0; d <= RECENT_SPEAKS_LOOKBACK_DAYS; d++) {
    const date = new Date(Date.now() - d * 86_400_000);
    files.push(join(getDataPath('history'), d === 0 ? todaySpeaksFile() : `speaks-${localDateKey(date)}.jsonl`));
  }

  const recent: RecentSpeak[] = [];
  for (const file of files) {
    if (recent.length >= limit) break;
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const pushed = content
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as SpeakRecord;
        } catch {
          return null; // 坏行 skip（观测路径，同 countGatePassedToday）
        }
      })
      .filter((r): r is SpeakRecord => r !== null && r.pushed === true && r.gated !== true && r.planLimited !== true);
    for (const r of pushed.reverse()) {
      if (recent.length >= limit) break;
      recent.push({ title: r.title, summary: r.summary, timestamp: r.timestamp });
    }
  }
  return recent;
}
