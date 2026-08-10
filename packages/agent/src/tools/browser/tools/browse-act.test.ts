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

import { browseActToolDef } from './browse-act.js';

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

function ok(data: Record<string, unknown> | null = null): BrowserCommandResult {
  return { success: true, data, error: null, durationMs: 10 };
}

type ActInput = Record<string, unknown>;

function getExecute(ctx: ToolContext) {
  const t = browseActToolDef.createTool(ctx) as unknown as {
    execute: (input: ActInput, opts: unknown) => Promise<Record<string, unknown>>;
  };
  return t.execute;
}

describe('browse_act', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('metadata: category 为 browser', () => {
    expect(browseActToolDef.metadata.name).toBe('browse_act');
    expect(browseActToolDef.metadata.category).toBe('browser');
  });

  describe('action → CLI 命令映射', () => {
    const cases: Array<{ name: string; input: ActInput; command: string; args: string[] }> = [
      { name: 'click', input: { action: 'click', selector: '@e1' }, command: 'click', args: ['@e1'] },
      { name: 'fill', input: { action: 'fill', selector: '@e2', text: 'hi' }, command: 'fill', args: ['@e2', 'hi'] },
      { name: 'type', input: { action: 'type', selector: '@e3', text: 'yo' }, command: 'type', args: ['@e3', 'yo'] },
      { name: 'press', input: { action: 'press', key: 'Enter' }, command: 'press', args: ['Enter'] },
      { name: 'scroll 默认', input: { action: 'scroll' }, command: 'scroll', args: ['down', '300'] },
      { name: 'scroll 自定义', input: { action: 'scroll', direction: 'up', pixels: 500 }, command: 'scroll', args: ['up', '500'] },
      { name: 'find_click', input: { action: 'find_click', locatorType: 'text', locatorValue: '登录' }, command: 'find', args: ['text', '登录', 'click'] },
      { name: 'find_fill', input: { action: 'find_fill', locatorType: 'label', locatorValue: '邮箱', text: 'a@b.c' }, command: 'find', args: ['label', '邮箱', 'fill', 'a@b.c'] },
      { name: 'wait', input: { action: 'wait', condition: '1000' }, command: 'wait', args: ['1000'] },
      { name: 'back', input: { action: 'back' }, command: 'back', args: [] },
      { name: 'tab_list', input: { action: 'tab_list' }, command: 'tab', args: [] },
      { name: 'tab_new 带 url', input: { action: 'tab_new', url: 'https://x.com' }, command: 'tab', args: ['new', 'https://x.com'] },
      { name: 'tab_new 无 url', input: { action: 'tab_new' }, command: 'tab', args: ['new'] },
      { name: 'tab_switch', input: { action: 'tab_switch', tabId: 't2' }, command: 'tab', args: ['t2'] },
      { name: 'tab_close 带 tabId', input: { action: 'tab_close', tabId: 't1' }, command: 'tab', args: ['close', 't1'] },
      { name: 'tab_close 无 tabId', input: { action: 'tab_close' }, command: 'tab', args: ['close'] },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const ctx = makeCtx();
        mockExecute.mockResolvedValueOnce(ok({ done: true }));

        const result = await getExecute(ctx)(c.input, {});

        expect(mockExecute).toHaveBeenCalledWith(c.command, c.args);
        expect(result).toEqual({ done: true });
        expect(ctx.stepCount).toBe(1);
        expect(ctx.wanderHistory).toHaveLength(1);
      });
    }
  });

  describe('缺少必填参数 → 返回 error，不调用 executor', () => {
    const cases: Array<{ name: string; input: ActInput; keyword: string }> = [
      { name: 'click 无 selector', input: { action: 'click' }, keyword: 'selector' },
      { name: 'fill 无 selector', input: { action: 'fill', text: 'x' }, keyword: 'selector' },
      { name: 'fill 无 text', input: { action: 'fill', selector: '@e1' }, keyword: 'text' },
      { name: 'type 无 selector', input: { action: 'type', text: 'x' }, keyword: 'selector' },
      { name: 'type 无 text', input: { action: 'type', selector: '@e1' }, keyword: 'text' },
      { name: 'press 无 key', input: { action: 'press' }, keyword: 'key' },
      { name: 'find_click 无 locatorType', input: { action: 'find_click', locatorValue: 'v' }, keyword: 'locatorType' },
      { name: 'find_click 无 locatorValue', input: { action: 'find_click', locatorType: 'text' }, keyword: 'locatorValue' },
      { name: 'find_fill 无 text', input: { action: 'find_fill', locatorType: 'text', locatorValue: 'v' }, keyword: 'text' },
      { name: 'wait 无 condition', input: { action: 'wait' }, keyword: 'condition' },
      { name: 'tab_switch 无 tabId', input: { action: 'tab_switch' }, keyword: 'tabId' },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const ctx = makeCtx();
        const result = await getExecute(ctx)(c.input, {});

        expect(mockExecute).not.toHaveBeenCalled();
        expect(result.error).toContain(c.keyword);
        expect(ctx.stepCount).toBe(1);
      });
    }
  });

  it('executor 失败：返回 error', async () => {
    const ctx = makeCtx();
    mockExecute.mockResolvedValueOnce({ success: false, data: null, error: '元素不存在', durationMs: 5 });

    const result = await getExecute(ctx)({ action: 'click', selector: '@e9' }, {});

    expect(result.error).toBe('元素不存在');
    expect(ctx.wanderHistory[0]?.thought).toContain('失败');
  });

  it('executor 成功但 data 为 null：返回 { success: true }', async () => {
    const ctx = makeCtx();
    mockExecute.mockResolvedValueOnce(ok(null));

    const result = await getExecute(ctx)({ action: 'back' }, {});

    expect(result).toEqual({ success: true });
  });
});
