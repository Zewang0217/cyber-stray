import { DuckDuckGoAdapter } from './duckduckgo.js';
import { TavilyAdapter } from './tavily.js';
import { ExaAdapter } from './exa.js';
import type { SearchAdapter, SearchOptions } from './adapter.js';
import type { SearchResult } from '../../types.js';
import { config } from '../../config.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('search');

const adapters: Map<string, SearchAdapter> = new Map();

adapters.set('duckduckgo', new DuckDuckGoAdapter());

if (config.searchApiKey) {
  adapters.set('tavily', new TavilyAdapter(config.searchApiKey));
}

if (config.exaApiKey) {
  adapters.set('exa', new ExaAdapter(config.exaApiKey));
}

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
  options?: SearchOptions & { adapter?: 'duckduckgo' | 'tavily' | 'exa' },
): Promise<SearchResult[]> {
  const adapterName = options?.adapter || config.searchProvider || 'duckduckgo';
  const adapter = adapters.get(adapterName);

  if (!adapter || !adapter.isAvailable()) {
    logger.warn(`适配器 ${adapterName} 不可用，回退到 DuckDuckGo`);
    const fallbackAdapter = adapters.get('duckduckgo')!;
    try {
      return await fallbackAdapter.search(query, options);
    } catch (error) {
      logger.error('搜索失败', { adapter: 'duckduckgo', error: String(error) });
      return [];
    }
  }

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

export async function premiumSearch(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const exaAdapter = adapters.get('exa');
  const tavilyAdapter = adapters.get('tavily');

  if (!exaAdapter && !tavilyAdapter) {
    logger.warn('premium 搜索无可用适配器（需配置 Exa 或 Tavily API key）');
    return [];
  }

  if (exaAdapter && exaAdapter.isAvailable()) {
    logger.info('执行 premium 搜索（Exa）', { query });
    try {
      const results = await exaAdapter.search(query, options);
      logger.success('premium 搜索完成（Exa）', { count: results.length });
      return results;
    } catch (error) {
      logger.warn('Exa 搜索失败，降级到 Tavily', { error: String(error) });
    }
  }

  if (tavilyAdapter && tavilyAdapter.isAvailable()) {
    logger.info('执行 premium 搜索降级（Tavily）', { query });
    try {
      const results = await tavilyAdapter.search(query, options);
      logger.success('premium 搜索完成（Tavily）', { count: results.length });
      return results;
    } catch (error) {
      logger.error('premium 搜索最终失败（Tavily）', { error: String(error) });
      return [];
    }
  }

  logger.error('premium 搜索无可用适配器');
  return [];
}

export { DuckDuckGoAdapter, TavilyAdapter, ExaAdapter };
export type { SearchAdapter, SearchOptions };
