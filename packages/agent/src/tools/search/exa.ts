import type { SearchResult } from '../../types.js';
import type { SearchAdapter, SearchOptions } from './adapter.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('exa');

interface ExaResult {
  title: string;
  url: string;
  text?: string;
  publishedDate?: string;
}

interface ExaResponse {
  results: ExaResult[];
}

export class ExaAdapter implements SearchAdapter {
  private readonly API_URL = 'https://api.exa.ai/search';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const numResults = options?.maxResults || 10;

    logger.info('请求 Exa API', { query, numResults });

    const response = await fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        query,
        type: 'auto',
        numResults,
        contents: {
          text: { maxCharacters: 4000 },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Exa API 返回 ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as ExaResponse;
    return this.parseResults(data.results);
  }

  getName(): string {
    return 'Exa';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  private parseResults(results: ExaResult[]): SearchResult[] {
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.text || '',
      score: r.publishedDate ? 1.0 : undefined,
    }));
  }
}