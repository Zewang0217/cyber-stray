import type { SearchResult } from '../../types.js';
import type { SearchAdapter, SearchOptions } from './adapter.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('tavily');

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export class TavilyAdapter implements SearchAdapter {
  private readonly API_URL = 'https://api.tavily.com/search';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = options?.maxResults || 10;

    logger.info('请求 Tavily API', { query, maxResults });

    const response = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Tavily API 返回 ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as TavilyResponse;
    return this.parseResults(data.results);
  }

  getName(): string {
    return 'Tavily';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  private parseResults(results: TavilyResult[]): SearchResult[] {
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));
  }
}