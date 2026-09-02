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
import { existsSync } from 'fs';
import { consola } from '../logger.js';
import { getDataPath } from '../config.js';
import { atomicWriteText } from '../utils/atomic-json.js';
import type { InterestGraph } from './interest-graph.js';

const logger = consola.withTag('ProfileSummary');

/** profile-summary 文件路径（调用时求值——测试在 import 后设 DATA_DIR） */
export function profileSummaryPath(): string {
  return getDataPath('user-profile/profile-summary.md');
}

/** 生成摘要文本（纯函数，可测）。按权重降序列 Top 兴趣 + 叶子 exemplars 提示。 */
export function renderProfileSummary(graph: InterestGraph): string {
  const top = graph.getTopInterestsWithWeights(10, 0.01);
  if (top.length === 0) {
    return '# profile-summary（派生摘要）\n\n图谱为空，暂无兴趣数据。\n';
  }

  const lines: string[] = ['# profile-summary（派生摘要）', ''];
  lines.push('> 本文件由用户兴趣图谱自动派生，请勿手改——改动会在下次反馈/反思时被覆盖。');
  lines.push('');

  for (const { id, weight } of top) {
    const node = graph.getNode(id);
    const pct = Math.round(weight * 100);
    const exemplarNote =
      node?.exemplars?.length && !graph.isLeaf(id)
        ? `（示例：${node.exemplars.slice(0, 2).join(' / ')}）`
        : '';
    lines.push(`- **${id}** — 相关度 ${pct}%${exemplarNote}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * 从图谱重生成 profile-summary.md（增量：内容未变则跳过写盘）。
 * 失败上抛（禁兜底）——反馈后摘要过期是静默数据不一致。
 */
export async function regenerateProfileSummary(graph: InterestGraph): Promise<boolean> {
  const rendered = renderProfileSummary(graph);
  const path = profileSummaryPath();

  // 增量：内容一致 → 不落盘（避免反馈高频路径无谓 I/O）
  if (existsSync(path)) {
    try {
      const existing = await readFile(path, 'utf-8');
      if (existing === rendered) {
        logger.debug('profile-summary 未变化，跳过写盘');
        return false;
      }
    } catch {
      // 读失败不静默——但写盘会覆盖，这里继续走重写路径
      logger.warn('读取现有 profile-summary 失败，将重写', { path });
    }
  }

  await atomicWriteText(path, rendered);
  logger.info('profile-summary 已重生成', { path, bytes: rendered.length });
  return true;
}
