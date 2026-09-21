/**
 * 进化历史的存储访问（基础设施层）
 *
 * interest-history.jsonl / feedback.json / state.json 的读取、快照追加
 * （O_APPEND 单行原子，与 agent 并发 append 竞态安全）、兴趣图谱回滚写。
 */

import { appendFile, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import type { InterestGraphData } from '@cyber-stray/shared/interest-graph';
import type { EvolutionSnapshot } from '../domain/evolution.js';
import { isEnoent } from './enoent.js';

/** 读 interest-history.jsonl 全部快照（坏行跳过，非 ENOENT 显式抛） */
export async function readEvolutionSnapshots(dir: string): Promise<EvolutionSnapshot[]> {
  let content: string;
  try {
    content = await readFile(join(dir, 'interest-history.jsonl'), 'utf-8');
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  const snapshots: EvolutionSnapshot[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<EvolutionSnapshot>;
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

/** 追加一条快照到历史（与 agent recordInterestSnapshot 同语义：单行原子追加） */
export async function appendEvolutionSnapshot(dir: string, snapshot: EvolutionSnapshot): Promise<void> {
  await appendFile(join(dir, 'interest-history.jsonl'), JSON.stringify(snapshot) + '\n', 'utf-8');
}

/** 反馈事件（feedback.json）；缺失 → [] */
export async function readFeedbackEvents(dir: string): Promise<unknown[]> {
  try {
    const content = await readFile(join(dir, 'feedback.json'), 'utf-8');
    const parsed = JSON.parse(content) as { feedbacks?: unknown[] };
    return Array.isArray(parsed.feedbacks) ? parsed.feedbacks : [];
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
}

/**
 * 回滚写：把快照节点还原为 user-interests.json（agent InterestGraphData
 * schema，形状来自 shared 单一真相源），tmp+rename 原子替换。
 */
export async function restoreInterestsGraph(
  dir: string,
  restored: InterestGraphData,
): Promise<void> {
  const profileDir = join(dir, 'user-profile');
  await mkdir(profileDir, { recursive: true });
  const interestsFile = join(profileDir, 'user-interests.json');
  const tmp = `${interestsFile}.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(tmp, JSON.stringify(restored, null, 2));
  await rename(tmp, interestsFile);
}
