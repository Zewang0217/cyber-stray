import { afterEach, describe, expect, it } from 'vitest';
import { securityHook } from './security.js';
import type { HookContext, HookDefinition } from './types.js';
import { makeState } from '../test/helpers.js';
import { getConfig, setTenantContext } from '../config.js';

function makeContext(): HookContext {
  const state = makeState();
  return {
    traceId: 'security-test', state, config: getConfig(), emit: () => {}, data: {},
    toolCtx: {
      state, traceId: 'security-test', stepCount: 0, wanderHistory: [], visitedUrls: [],
      spokeTimes: 0, pendingFeedbackCount: 0, endReason: 'rest', startTime: Date.now(), searchQueries: [],
    },
  };
}

afterEach(() => setTenantContext(null));

describe('security hook', () => {
  const hook: HookDefinition = securityHook;
  it.each(['read_page', 'browse_page'])('阻止 %s 访问私网并记录拒绝原因', async (tool) => {
    const context = makeContext();
    const result = await hook.beforeToolCall!(context, tool, { url: 'http://127.0.0.1/admin' });
    expect(result.action).toBe('deny');
    expect(context.toolCtx.wanderHistory[0]?.thought).toContain('非公网');
    expect(context.toolCtx.stepCount).toBe(1);
  });

  it('租户浏览器 fail closed；公开 read_page 可继续交给真实出站边界检查', async () => {
    setTenantContext({ tenantId: 'tenant-security', dataDir: '/tmp/security-hook-unused', config: getConfig() });
    const context = makeContext();
    expect(await hook.beforeToolCall!(context, 'browse_act', { action: 'back' })).toMatchObject({ action: 'deny', reason: expect.stringContaining('租户浏览器已停用') });
    expect(await hook.beforeToolCall!(context, 'read_page', { url: 'https://example.com' })).toEqual({ action: 'allow' });
  });
});
