import { describe, test, expect } from 'bun:test';
import { calculateScore, scoreResults } from './scoring.js';
import type { SearchResult, AgentState } from '../../types.js';

describe('scoring', () => {
  const defaultState: AgentState = {
    boredom: 30,
    energy: 80,
    mood: 'curious',
    temper: 20,
    stubbornness: 30,
    lastAction: null,
    lastActionTime: null,
    lastHuntResult: null,
    recentTopics: [],
    userLikes: [],
    userDislikes: [],
    totalHunts: 0,
    totalPushes: 0,
    consecutiveFailures: 0,
    lastHeartbeat: new Date().toISOString(),
    lastHunt: null,
    lastRest: null,
  };

  test('基础评分返回 0.5', () => {
    const result: SearchResult = {
      title: 'Test Title',
      url: 'https://example.com',
      content: 'This is a test content with enough length to pass the minimum threshold check.',
    };

    const scored = calculateScore(result, defaultState);
    expect(scored.score).toBe(0.5);
    expect(scored.reason).toBe('基础评分');
  });

  test('匹配用户喜好加分', () => {
    const state: AgentState = {
      ...defaultState,
      userLikes: ['科技', 'AI'],
    };

    const result: SearchResult = {
      title: 'AI 技术最新进展',
      url: 'https://example.com',
      content: '关于科技行业的最新动态...',
    };

    const scored = calculateScore(result, state);
    expect(scored.score).toBeGreaterThan(0.5);
    expect(scored.reason).toContain('匹配用户喜好');
  });

  test('匹配用户不喜欢扣分', () => {
    const state: AgentState = {
      ...defaultState,
      userDislikes: ['广告', '推广'],
    };

    const result: SearchResult = {
      title: '广告推广信息',
      url: 'https://example.com',
      content: '这是一条广告推广内容',
    };

    const scored = calculateScore(result, state);
    expect(scored.score).toBeLessThan(0.5);
    expect(scored.reason).toContain('匹配用户不喜欢');
  });

  test('内容过短扣分', () => {
    const result: SearchResult = {
      title: '短标题',
      url: 'https://example.com',
      content: '短内容',
    };

    const scored = calculateScore(result, defaultState);
    expect(scored.score).toBeLessThan(0.5);
    expect(scored.reason).toContain('内容过短');
  });

  test('内容丰富加分', () => {
    const longContent = '这是一段很长的内容，包含了很多详细信息，足够长以至于超过了200个字符的阈值，这样就可以获得内容丰富的加分奖励。这段内容模拟了真实的文章摘要，提供了足够的上下文信息供用户阅读和判断是否感兴趣。我们需要确保内容足够长以满足评分算法的要求。继续添加更多内容来确保超过200字符的限制。这里是额外的内容部分，用于填充文本使其达到所需的长度标准。最后还有一些补充说明和细节描述。再加一点内容确保超过两百字符的阈值要求。';
    const result: SearchResult = {
      title: '详细文章',
      url: 'https://example.com',
      content: longContent,
    };

    const scored = calculateScore(result, defaultState);
    expect(scored.score).toBeGreaterThan(0.5);
    expect(scored.reason).toContain('内容丰富');
  });

  test('话题匹配标题加分', () => {
    const result: SearchResult = {
      title: 'Rust 编程语言入门指南',
      url: 'https://example.com',
      content: 'Rust 是一门现代编程语言...',
    };

    const scored = calculateScore(result, defaultState, 'Rust');
    expect(scored.score).toBeGreaterThan(0.5);
    expect(scored.reason).toContain('标题匹配话题');
  });

  test('话题匹配内容加分', () => {
    const result: SearchResult = {
      title: '编程语言指南',
      url: 'https://example.com',
      content: '本文详细介绍 Rust 语言的特点和优势，以及如何在项目中使用 Rust 进行开发。Rust 是一门现代编程语言，具有内存安全和并发安全的特点。',
    };

    const scored = calculateScore(result, defaultState, 'Rust');
    expect(scored.score).toBeGreaterThan(0.5);
    expect(scored.reason).toContain('内容匹配话题');
  });

  test('评分范围限制在 0-1', () => {
    const state: AgentState = {
      ...defaultState,
      userLikes: ['test'],
      userDislikes: ['test'],
    };

    const result: SearchResult = {
      title: 'test title',
      url: 'https://example.com',
      content: 'test content with keyword test',
    };

    const scored = calculateScore(result, state);
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(1);
  });

  test('批量评分返回正确数量', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.com', content: 'Content A' },
      { title: 'B', url: 'https://b.com', content: 'Content B' },
      { title: 'C', url: 'https://c.com', content: 'Content C' },
    ];

    const scored = scoreResults(results, defaultState);
    expect(scored.length).toBe(3);
    expect(scored[0]!.score).toBeDefined();
    expect(scored[0]!.reason).toBeDefined();
  });

  test('批量评分按话题相关性排序', () => {
    const state: AgentState = {
      ...defaultState,
      userLikes: ['AI'],
    };

    const results: SearchResult[] = [
      { title: '普通新闻', url: 'https://a.com', content: '普通新闻内容' },
      { title: 'AI 技术突破', url: 'https://b.com', content: 'AI 领域最新突破' },
      { title: '其他话题', url: 'https://c.com', content: '其他内容' },
    ];

    const scored = scoreResults(results, state, 'AI');
    const aiResult = scored.find(r => r.title.includes('AI'));
    expect(aiResult?.score).toBeGreaterThan(scored.find(r => r.title === '普通新闻')?.score ?? 0);
  });
});