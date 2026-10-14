import { describe, test, expect } from 'vitest';
import { extractRecentTopics } from './wander-agent.js';
import type { WanderStep } from '../types.js';

function step(partial: Partial<WanderStep> & { tool: string }): WanderStep {
  return { timestamp: '2026-10-14T00:00:00.000Z', thought: '', ...partial } as WanderStep;
}

describe('extractRecentTopics（兴趣回灌候选提取）', () => {
  test('record_knowledge 的 title 是干净话题，必须进候选（#422 喂料修复）', () => {
    const topics = extractRecentTopics([
      step({ tool: 'record_knowledge', title: '蜜蜂螫针是一台双活塞微型泵' }),
    ], []);
    expect(topics).toContain('蜜蜂螫针是一台双活塞微型泵');
  });

  test('record_knowledge 旧数据无 title 时回退 thought 前缀「记住了: 」', () => {
    const topics = extractRecentTopics([
      step({ tool: 'record_knowledge', thought: '记住了: 深海硫化物岩石上岸会自燃' }),
    ], []);
    expect(topics).toContain('深海硫化物岩石上岸会自燃');
  });

  test('search_web 的 query 与 URL 主机名仍进候选（准入过滤在 reinforce 层做）', () => {
    const topics = extractRecentTopics([
      step({ tool: 'search_web', title: 'Meta MTIA AI chip production September 2026 Reuters' }),
      step({ tool: 'read_page', url: 'https://www.ithome.com/x' }),
    ], []);
    expect(topics).toContain('Meta MTIA AI chip production September 2026 Reuters');
    expect(topics).toContain('www.ithome.com');
  });

  test('existingTopics 保留，窗口截尾到 10 条', () => {
    const base = Array.from({ length: 8 }, (_, i) => `旧话题${i}`);
    const topics = extractRecentTopics([
      step({ tool: 'record_knowledge', title: '新话题甲' }),
      step({ tool: 'record_knowledge', title: '新话题乙' }),
      step({ tool: 'record_knowledge', title: '新话题丙' }),
    ], base);
    expect(topics).toHaveLength(10);
    expect(topics.slice(-3)).toEqual(['新话题甲', '新话题乙', '新话题丙']);
  });
});
