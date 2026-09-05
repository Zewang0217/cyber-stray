/**
 * profile-summary 派生摘要（S2 #151）
 *
 * 从用户兴趣图谱派生 `user-profile/profile-summary.md`，是图谱的只读投影——
 * 不独立维护叙述（单写者纪律：唯一真相源 = user-interests.json）。
 *
 * 触发：
 * - 反馈后增量重生成（processFeedback / boostTopic 完成后调用本模块）
 * - 反思时由后续 slice（S4）接整图重生（同一函数，无状态差异）
 *
 * 增量语义：图谱未变化（内容与现有文件一致）时不落盘，避免无谓 I/O。
 */

import { readFile } from 'fs/promises';
import { consola } from '../logger.js';
import { getDataPath } from '../config.js';
import { atomicWriteText } from '../utils/atomic-json.js';
import type { InterestGraph } from './interest-graph.js';

const logger = consola.withTag('ProfileSummary');

/** 摘要条目上限：prompt 注入用的派生摘要，10 条足够承载当前兴趣面 */
const SUMMARY_TOP_N = 10;

/** 低于此持久化权重的节点不进摘要（与 InterestGraphConfig.minWeight 的 dormancy 语义无关，仅排版降噪） */
const SUMMARY_MIN_WEIGHT = 0.01;

/** profile-summary 文件路径（调用时求值——测试在 import 后设 DATA_DIR） */
export function profileSummaryPath(): string {
  return getDataPath('user-profile/profile-summary.md');
}

/**
 * 生成摘要文本（纯函数，可测）。按权重降序列 Top 兴趣 + 叶子 exemplars 提示。
 *
 * 展示**持久化原始权重**而非读取时衰减值：本摘要是落盘图谱的投影，
 * 用衰减值会随时间与图谱本身漂移（review #159）——时间衰减只在
 * prompt 注入等读取方承担。
 */
export function renderProfileSummary(graph: InterestGraph): string {
  const top = graph
    .getAllNodes()
    .filter((n) => n.weight >= SUMMARY_MIN_WEIGHT)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, SUMMARY_TOP_N);
  if (top.length === 0) {
    return '# profile-summary（派生摘要）\n\n图谱为空，暂无兴趣数据。\n';
  }

  const lines: string[] = ['# profile-summary（派生摘要）', ''];
  lines.push('> 本文件由用户兴趣图谱自动派生，请勿手改——改动会在下次反馈/反思时被覆盖。');
  lines.push('');

  for (const node of top) {
    const pct = Math.round(node.weight * 100);
    const exemplarNote =
      node.exemplars?.length && !graph.isLeaf(node.id)
        ? `（示例：${node.exemplars.slice(0, 2).join(' / ')}）`
        : '';
    lines.push(`- **${node.id}** — 相关度 ${pct}%${exemplarNote}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * 从图谱重生成 profile-summary.md（增量：内容未变则跳过写盘）。
 * 失败上抛（禁兜底）——反馈后摘要过期是静默数据不一致。
 * 仅 ENOENT 视为"尚未生成，走重写"；其余读错误原样上抛。
 */
export async function regenerateProfileSummary(graph: InterestGraph): Promise<boolean> {
  const rendered = renderProfileSummary(graph);
  const path = profileSummaryPath();

  // 增量：内容一致 → 不落盘（避免反馈高频路径无谓 I/O）
  let existing: string | undefined;
  try {
    existing = await readFile(path, 'utf-8');
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  if (existing !== undefined && existing === rendered) {
    logger.debug('profile-summary 未变化，跳过写盘');
    return false;
  }

  await atomicWriteText(path, rendered);
  logger.info('profile-summary 已重生成', { path, bytes: rendered.length });
  return true;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}
