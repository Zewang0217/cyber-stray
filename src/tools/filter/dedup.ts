import { getUrlHash, loadPushHistory } from './history.js';
import { consola } from '../../logger.js';
import type { SearchResult } from '../../types.js';

const logger = consola.withTag('filter-dedup');

export function dedupByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const hash = getUrlHash(result.url);
    if (!seen.has(hash)) {
      seen.add(hash);
      deduped.push(result);
    } else {
      logger.debug('URL 去重', { url: result.url });
    }
  }

  return deduped;
}

export async function dedupByHistory(results: SearchResult[]): Promise<SearchResult[]> {
  const history = await loadPushHistory();
  const pushedHashes = new Set(history.pushedUrls.map(item => item.hash));

  const deduped: SearchResult[] = [];

  for (const result of results) {
    const hash = getUrlHash(result.url);
    if (!pushedHashes.has(hash)) {
      deduped.push(result);
    } else {
      logger.debug('历史去重', { url: result.url });
    }
  }

  return deduped;
}

export async function dedupResults(results: SearchResult[]): Promise<SearchResult[]> {
  const urlDeduped = dedupByUrl(results);
  const historyDeduped = await dedupByHistory(urlDeduped);

  const removedByUrl = results.length - urlDeduped.length;
  const removedByHistory = urlDeduped.length - historyDeduped.length;

  if (removedByUrl > 0 || removedByHistory > 0) {
    logger.info('去重完成', {
      original: results.length,
      afterUrlDedup: urlDeduped.length,
      afterHistoryDedup: historyDeduped.length,
      removedByUrl,
      removedByHistory,
    });
  }

  return historyDeduped;
}