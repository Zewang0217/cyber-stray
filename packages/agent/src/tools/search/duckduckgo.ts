import type { SearchResult } from '../../types.js';
import type { SearchAdapter, SearchOptions } from './adapter.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('duckduckgo');

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
  Icon?: { URL?: string };
}

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

export class DuckDuckGoAdapter implements SearchAdapter {
  private readonly API_URL = 'https://api.duckduckgo.com/';

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const url = this.buildRequestUrl(query);
    logger.info('请求 DuckDuckGo API', { query });

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!response.ok) {
      throw new Error(`DuckDuckGo API 返回 ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as DuckDuckGoResponse;
    return this.parseResults(data, options?.maxResults);
  }

  getName(): string {
    return 'DuckDuckGo';
  }

  isAvailable(): boolean {
    return true;
  }

  private buildRequestUrl(query: string): string {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });
    return `${this.API_URL}?${params}`;
  }

  private parseResults(data: DuckDuckGoResponse, limit?: number): SearchResult[] {
    const results: SearchResult[] = [];

    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource || 'DuckDuckGo',
        url: data.AbstractURL,
        content: data.AbstractText,
        score: 1.0,
      });
    }

    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      const maxTopics = limit ? Math.max(0, limit - results.length) : 10;
      for (const topic of data.RelatedTopics.slice(0, maxTopics)) {
        if (topic.FirstURL && topic.Text) {
          results.push({
            title: this.extractTitle(topic.Text),
            url: topic.FirstURL,
            content: topic.Text,
          });
        }
      }
    }

    return results.slice(0, limit || results.length);
  }

  private extractTitle(text: string): string {
    const dashIndex = text.indexOf(' - ');
    return dashIndex > 0 ? text.slice(0, dashIndex) : text.slice(0, 50);
  }
}
