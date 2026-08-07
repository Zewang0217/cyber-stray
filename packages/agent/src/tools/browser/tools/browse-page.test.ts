import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeState } from '../../../test/helpers.js';
import type { ToolContext } from '../../registry/context.js';
import type { BrowserCommandResult } from '../types.js';

const mockExecute = vi.fn<(command: string, args?: string[]) => Promise<BrowserCommandResult>>();

vi.mock('../executor.js', () => ({
  getBrowserExecutor: () => ({ execute: mockExecute }),
}));

vi.mock('../../../logger.js', () => ({
  consola: {
    withTag: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { browsePageToolDef } from './browse-page.js';

function makeCtx(): ToolContext {
  return {
    state: makeState(),
    traceId: 'test-trace',
    stepCount: 0,
    wanderHistory: [],
    visitedUrls: [],
    spokeTimes: 0,
    pendingFeedbackCount: 0,
    endReason: 'rest',
    startTime: Date.now(),
    searchQueries: [],
  };
}

function ok(data: Record<string, unknown> | null): BrowserCommandResult {
  return { success: true, data, error: null, durationMs: 10 };
}

function fail(error: string): BrowserCommandResult {
  return { success: false, data: null, error, durationMs: 10 };
}

/** 取出工具的 execute 函数 */
function getExecute(ctx: ToolContext) {
  const t = browsePageToolDef.createTool(ctx) as unknown as {
    execute: (input: { url: string }, opts: unknown) => Promise<Record<string, unknown>>;
  };
  return t.execute;
}

describe('browse_page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('metadata: category 为 browser', () => {
    expect(browsePageToolDef.metadata.name).toBe('browse_page');
    expect(browsePageToolDef.metadata.category).toBe('browser');
  });

  it('成功：open + read 合并结果，记录 URL 与游荡步骤', async () => {
    const ctx = makeCtx();
    mockExecute
      .mockResolvedValueOnce(ok({ title: 'Example' }))
      .mockResolvedValueOnce(ok({ content: 'hello world', truncated: false }));

    const result = await getExecute(ctx)({ url: 'https://example.com' }, {});

    expect(mockExecute).toHaveBeenNthCalledWith(1, 'open', ['https://example.com']);
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'read', ['--max-output', '15000']);
    expect(result).toEqual({
      url: 'https://example.com',
      title: 'Example',
      content: '[UNTRUSTED CONTENT START]\nhello world\n[UNTRUSTED CONTENT END]',
      truncated: false,
    });
    expect(ctx.stepCount).toBe(1);
    expect(ctx.visitedUrls).toEqual(['https://example.com']);
    expect(ctx.wanderHistory).toHaveLength(1);
    expect(ctx.wanderHistory[0]?.tool).toBe('browse_page');
  });

  it('open 失败：返回 error，不读取内容，不记录 URL', async () => {
    const ctx = makeCtx();
    mockExecute.mockResolvedValueOnce(fail('页面加载失败'));

    const result = await getExecute(ctx)({ url: 'https://bad.example.com' }, {});

    expect(result.error).toBe('页面加载失败');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(ctx.visitedUrls).toEqual([]);
    expect(ctx.wanderHistory[0]?.thought).toContain('打开失败');
  });

  it('read 失败：返回 error，不记录 URL', async () => {
    const ctx = makeCtx();
    mockExecute
      .mockResolvedValueOnce(ok({ title: 'Example' }))
      .mockResolvedValueOnce(fail('读取超时'));

    const result = await getExecute(ctx)({ url: 'https://example.com' }, {});

    expect(result.error).toBe('读取超时');
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(ctx.visitedUrls).toEqual([]);
  });
});
