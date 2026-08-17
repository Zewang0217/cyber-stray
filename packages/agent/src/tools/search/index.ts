import { DuckDuckGoAdapter } from './duckduckgo.js';
import { TavilyAdapter } from './tavily.js';
import { ExaAdapter } from './exa.js';
import type { SearchAdapter, SearchOptions } from './adapter.js';
import type { SearchResult } from '../../types.js';
import { getConfig } from '../../config.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('search');

/** DuckDuckGo 免 key，进程级单例 */
const duckDuckGo = new DuckDuckGoAdapter();

/**
 * 按当前生效配置取适配器；未配置 key 的 premium 适配器返回 null（调用方回退）。
 *
 * 旧版在模块加载期根据首个 config 建 Tavily/Exa 并缓存——租户模式下会把
 * 所有租户钉死成首个加载者的 key。改为按调用时配置惰性构造（适配器无状态，
 * 构造代价可忽略）。
 */
function getConfiguredAdapter(name: string): SearchAdapter | null {
  const cfg = getConfig();
  if (name === 'tavily') return cfg.searchApiKey ? new TavilyAdapter(cfg.searchApiKey) : null;
  if (name === 'exa') return cfg.exaApiKey ? new ExaAdapter(cfg.exaApiKey) : null;
  return duckDuckGo;
}

function getDefaultAdapter(): SearchAdapter {
  const name = getConfig().searchProvider || 'duckduckgo';
  const adapter = getConfiguredAdapter(name);

  if (!adapter || !adapter.isAvailable()) {
    logger.warn(`适配器 ${name} 不可用，回退到 DuckDuckGo`);
    return duckDuckGo;
  }

  return adapter;
}

export async function search(
  query: string,
  options?: SearchOptions & { adapter?: 'duckduckgo' | 'tavily' | 'exa' },
): Promise<SearchResult[]> {
  const cfg = getConfig();
  const adapterName = options?.adapter || cfg.searchProvider || 'duckduckgo';
  const adapter = getConfiguredAdapter(adapterName);

  if (!adapter || !adapter.isAvailable()) {
    logger.warn(`适配器 ${adapterName} 不可用，回退到 DuckDuckGo`);
    try {
      return await duckDuckGo.search(query, options);
    } catch (error) {
      logger.error('搜索失败', { adapter: 'duckduckgo', error: String(error) });
      return [];
    }
  }

  logger.info('执行搜索', {
    adapter: adapter.getName(),
    query,
    maxResults: options?.maxResults || cfg.maxSearchResults,
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
  const exaAdapter = getConfiguredAdapter('exa');
  const tavilyAdapter = getConfiguredAdapter('tavily');

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
