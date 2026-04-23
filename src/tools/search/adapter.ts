import type { SearchResult } from '../../types.js';

export type { SearchResult };

export interface SearchOptions {
  maxResults?: number;
  freshness?: string;
  region?: string;
}

export interface SearchAdapter {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  getName(): string;
  isAvailable(): boolean;
}
