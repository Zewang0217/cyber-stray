import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { generatePushContent } from './generator.js';
import type { AgentState } from '../../types.js';
import type { FilteredResult } from '../filter/index.js';

// ============================================
// Test helpers
// ============================================

const defaultState: AgentState = {
  boredom: 60,
  energy: 70,
  mood: 'curious',
  temper: 20,
  stubbornness: 30,
  lastAction: null,
  lastActionTime: null,
  lastHuntResult: null,
  recentTopics: [],
  userLikes: ['科技', 'AI'],
  userDislikes: [],
  totalHunts: 5,
  totalPushes: 3,
  consecutiveFailures: 0,
  lastHeartbeat: new Date().toISOString(),
  lastHunt: null,
  lastRest: null,
};

const mockResult: FilteredResult = {
  title: 'OpenAI 发布 GPT-5，震惊业界',
  url: 'https://example.com/gpt5',
  content: '根据最新报道，OpenAI 今日正式发布了 GPT-5 模型，该模型在多项基准测试中大幅超越前代，推理能力接近人类专家水平。',
  score: 0.85,
  reason: '匹配用户喜好; 内容丰富',
};

/** 用于 mock fetch / LLM 调用 */
let originalFetch: typeof globalThis.fetch;

function mockFetch(responseBody: string, status = 200): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'test-id',
          object: 'chat.completion',
          choices: [
            {
              message: { role: 'assistant', content: responseBody },
              finish_reason: 'stop',
              index: 0,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        {
          status,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )) as unknown as typeof fetch;
}

function mockFetchError(): void {
  globalThis.fetch = (() => Promise.reject(new Error('网络错误'))) as unknown as typeof fetch;
}

// ============================================
// Tests
// ============================================

describe('generatePushContent', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // 确保有 API Key（测试环境）
    process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('正常生成：返回完整 PushContent 结构', async () => {
    mockFetch('嘿主人！OpenAI 又整活了，这次 GPT-5 直接把我看呆了，你得瞅瞅。');

    const result = await generatePushContent(mockResult, defaultState);

    expect(result.title).toBe(mockResult.title);
    expect(result.url).toBe(mockResult.url);
    expect(result.summary).toBe(mockResult.content);
    expect(result.message).toBeTruthy();
    expect(result.mood).toBe(defaultState.mood);
    expect(result.timestamp).toBeTruthy();
    // timestamp 应为合法 ISO 字符串
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  test('正常生成：message 不为空且去除首尾空白', async () => {
    mockFetch('  \n  这是一条推荐语  \n  ');

    const result = await generatePushContent(mockResult, defaultState);

    expect(result.message).toBe('这是一条推荐语');
  });

  test('grumpy 心情：仍然正常返回文案', async () => {
    const grumpyState: AgentState = { ...defaultState, mood: 'grumpy', temper: 75 };
    mockFetch('烦死了，但这东西你还是看一眼吧，将就。');

    const result = await generatePushContent(mockResult, grumpyState);

    expect(result.message).toBe('烦死了，但这东西你还是看一眼吧，将就。');
    expect(result.mood).toBe('grumpy');
  });

  test('excited 心情：仍然正常返回文案', async () => {
    const excitedState: AgentState = { ...defaultState, mood: 'excited' };
    mockFetch('哇哇哇！！这个太绝了！GPT-5 直接出来了！！！赶紧看！！！');

    const result = await generatePushContent(mockResult, excitedState);

    expect(result.mood).toBe('excited');
    expect(result.message).toBeTruthy();
  });

  test('LLM 调用失败：返回默认文案，不抛出异常', async () => {
    mockFetchError();

    const result = await generatePushContent(mockResult, defaultState);

    expect(result.message).toBe('嘿，找到个有意思的东西，看看？');
    expect(result.title).toBe(mockResult.title);
    expect(result.url).toBe(mockResult.url);
  });

  test('LLM 返回空文案：回退到默认文案', async () => {
    mockFetch('');

    const result = await generatePushContent(mockResult, defaultState);

    expect(result.message).toBe('嘿，找到个有意思的东西，看看？');
  });

  test('content 为空：summary 使用 title 代替', async () => {
    const emptyContentResult: FilteredResult = {
      ...mockResult,
      content: '',
    };
    mockFetch('看看这个标题，感觉很有料');

    const result = await generatePushContent(emptyContentResult, defaultState);

    expect(result.summary).toBe(emptyContentResult.title);
  });

  test('content 超长：summary 仍为原始 content（不截断）', async () => {
    const longContent = 'A'.repeat(1000);
    const longContentResult: FilteredResult = {
      ...mockResult,
      content: longContent,
    };
    mockFetch('长文一枚，慢慢看');

    const result = await generatePushContent(longContentResult, defaultState);

    // summary 直接用 content，不截断
    expect(result.summary).toBe(longContent);
  });

  test('score 很低的结果：仍正常生成（筛选层已处理，这里不再校验）', async () => {
    const lowScoreResult: FilteredResult = {
      ...mockResult,
      score: 0.31,
    };
    mockFetch('一般般，但给你看看吧');

    const result = await generatePushContent(lowScoreResult, defaultState);

    expect(result.message).toBeTruthy();
  });
});
