/**
 * 口头禅演化历史（#114 / ADR 0005）
 *
 * catchphrase-history.jsonl：O_APPEND 单行原子追加（与 interest-history.jsonl
 * 同语义——整文件重写会与并发方竞态丢行）。暂不展示，可扩展为设置页
 * "口头禅变迁"时间线；反馈归因（agent 侧）与本模块（CP 侧）追加同格式。
 */

import { appendFile } from 'fs/promises';
import { join } from 'path';
import type { Catchphrase } from '@cyber-stray/shared';

/** 历史行：某时刻的完整口头禅集合快照 + 变更原因 */
export interface CatchphraseHistoryEntry {
  timestamp: string;
  /** 变更原因：adopt / settings / feedback */
  reason: string;
  catchphrases: Catchphrase[];
}

/** 追加一条演化历史到租户数据目录 */
export async function appendCatchphraseHistory(
  dir: string,
  reason: string,
  catchphrases: Catchphrase[],
): Promise<void> {
  const entry: CatchphraseHistoryEntry = {
    timestamp: new Date().toISOString(),
    reason,
    catchphrases,
  };
  await appendFile(
    join(dir, 'catchphrase-history.jsonl'),
    JSON.stringify(entry) + '\n',
    'utf-8',
  );
}
