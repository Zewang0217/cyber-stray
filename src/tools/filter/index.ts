/**
 * @deprecated 使用 LLM Tool Calling 替代
 *
 * 原因：ReAct 架构中，筛选逻辑由 LLM 自主判断，
 * 不需要硬编码的评分和过滤规则。
 *
 * 替代方案：src/agent/react.ts 中的 Tool Calling 循环
 *
 * 保留此文件供参考，后续可能删除。
 */
import { dedupResults } from './dedup.js';
import { scoreResults, type ScoringResult } from './scoring.js';
import { consola } from '../../logger.js';
import type { SearchResult, AgentState } from '../../types.js';

const logger = consola.withTag('filter');

export interface FilterOptions {
  maxResults?: number;
  minScore?: number;
  dedupHistory?: boolean;
  topic?: string;
}

export type FilteredResult = ScoringResult;

function filterDislikes(
  results: SearchResult[],
  state: AgentState,
): SearchResult[] {
  if (state.userDislikes.length === 0) {
    return results;
  }

  return results.filter(result => {
    const titleMatch = state.userDislikes.some(
      d => result.title.toLowerCase().includes(d.toLowerCase()),
    );
    const contentMatch = state.userDislikes.some(
      d => result.content.toLowerCase().includes(d.toLowerCase()),
    );

    if (titleMatch || contentMatch) {
      logger.debug('过滤用户不喜欢', { url: result.url, title: result.title });
      return false;
    }
    return true;
  });
}

export async function filterResults(
  results: SearchResult[],
  state: AgentState,
  options?: FilterOptions,
): Promise<FilteredResult[]> {
  if (results.length === 0) {
    logger.info('无搜索结果，跳过筛选');
    return [];
  }

  const dedupEnabled = options?.dedupHistory ?? true;

  let processedResults: SearchResult[];

  if (dedupEnabled) {
    processedResults = await dedupResults(results);
  } else {
    processedResults = results;
  }

  const filtered = filterDislikes(processedResults, state);

  const scored = scoreResults(filtered, state, options?.topic);

  const sorted = scored.sort((a, b) => b.score - a.score);

  const threshold = options?.minScore ?? 0.3;
  const qualified = sorted.filter(r => r.score >= threshold);

  const maxResults = options?.maxResults ?? 5;
  const finalResults = qualified.slice(0, maxResults);

  logger.info('筛选完成', {
    original: results.length,
    afterDedup: processedResults.length,
    afterFilter: filtered.length,
    qualified: qualified.length,
    returned: finalResults.length,
    topScore: finalResults[0]?.score ?? 0,
  });

  return finalResults;
}

export { getUrlHash, addToHistory, loadPushHistory, savePushHistory } from './history.js';
export { dedupByUrl, dedupByHistory, dedupResults } from './dedup.js';
export { calculateScore, scoreResults } from './scoring.js';