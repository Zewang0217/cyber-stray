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

import { browseSnapshotToolDef } from './browse-snapshot.js';

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

type SnapshotInput = { interactive?: boolean; selector?: string };

function getExecute(ctx: ToolContext) {
  const t = browseSnapshotToolDef.createTool(ctx) as unknown as {
    execute: (input: SnapshotInput, opts: unknown) => Promise<Record<string, unknown>>;
  };
  return t.execute;
}

describe('browse_snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('metadata: category 为 browser', () => {
    expect(browseSnapshotToolDef.metadata.name).toBe('browse_snapshot');
    expect(browseSnapshotToolDef.metadata.category).toBe('browser');
  });

  it('默认 interactive=true：传 -i 参数', async () => {
    const ctx = makeCtx();
    mockExecute.mockResolvedValueOnce(
      ok({ snapshot: '@e1 button', refs: ['@e1'], origin: 'https://example.com' }),
    );

    const result = await getExecute(ctx)({ interactive: true }, {});

    expect(mockExecute).toHaveBeenCalledWith('snapshot', ['-i']);
    expect(result).toEqual({
      snapshot: '[UNTRUSTED CONTENT START]\n@e1 button\n[UNTRUSTED CONTENT END]',
      refs: ['@e1'],
      url: 'https://example.com',
    });
    expect(ctx.stepCount).toBe(1);
    expect(ctx.wanderHistory).toHaveLength(1);
  });

  it('interactive=false 且带 selector：只传 -s', async () => {
    const ctx = makeCtx();
    mockExecute.mockResolvedValueOnce(ok({ snapshot: 'nav', refs: [], origin: 'https://example.com' }));

    await getExecute(ctx)({ interactive: false, selector: 'nav' }, {});

    expect(mockExecute).toHaveBeenCalledWith('snapshot', ['-s', 'nav']);
  });

  it('interactive=true 且带 selector：同时传 -i 和 -s', async () => {
    const ctx = makeCtx();
    mockExecute.mockResolvedValueOnce(ok({ snapshot: 'x', refs: [], origin: 'u' }));

    await getExecute(ctx)({ interactive: true, selector: 'main' }, {});

    expect(mockExecute).toHaveBeenCalledWith('snapshot', ['-i', '-s', 'main']);
  });

  it('失败：返回 error', async () => {
    const ctx = makeCtx();
    mockExecute.mockResolvedValueOnce({ success: false, data: null, error: '无页面', durationMs: 5 });

    const result = await getExecute(ctx)({ interactive: true }, {});

    expect(result.error).toBe('无页面');
    expect(ctx.wanderHistory[0]?.thought).toContain('快照失败');
  });
});
