import { DuckDuckGoAdapter } from './duckduckgo.js';
import type { SearchAdapter, SearchOptions } from './adapter.js';
import type { SearchResult } from '../../types.js';
import { config } from '../../config.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('search');

const adapters: Map<string, SearchAdapter> = new Map();

adapters.set('duckduckgo', new DuckDuckGoAdapter());

function getDefaultAdapter(): SearchAdapter {
  const name = config.searchProvider || 'duckduckgo';
  const adapter = adapters.get(name);

  if (!adapter || !adapter.isAvailable()) {
    logger.warn(`适配器 ${name} 不可用，回退到 DuckDuckGo`);
    return adapters.get('duckduckgo')!;
  }

  return adapter;
}

export async function search(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const adapter = getDefaultAdapter();

  logger.info('执行搜索', {
    adapter: adapter.getName(),
    query,
    maxResults: options?.maxResults || config.maxSearchResults,
  });

  try {
    const results = await adapter.search(query, options);

    logger.success('搜索完成', {
      count: results.length,
      adapter: adapter.getName(),
    });

    return results;
  } catch (error) {
    logger.error('搜索失败', {
      adapter: adapter.getName(),
      error: String(error),
    });
    return [];
  }
}

export { DuckDuckGoAdapter };
export type { SearchAdapter, SearchOptions };
