/** URL 输入护栏。真实 SSRF 边界仍由 reader 的出站传输和浏览器执行器强制执行。 */
import { z } from 'zod';
import { parsePublicHttpUrl } from '@cyber-stray/shared/outbound';
import { getTenantId } from '../config.js';
import { TENANT_BROWSER_DISABLED_REASON } from '../tools/browser/policy.js';
import { pushWanderStep } from '../tools/registry/context.js';
import type { HookDefinition } from './types.js';

const pageInput = z.object({ url: z.string() });
const actionInput = z.object({ action: z.string(), url: z.string().optional() });

function validateInput(tool: string, params: unknown): void {
  if (tool.startsWith('browse_') && getTenantId() !== null) {
    throw new Error(TENANT_BROWSER_DISABLED_REASON);
  }
  if (tool === 'read_page' || tool === 'browse_page') {
    parsePublicHttpUrl(pageInput.parse(params).url);
  }
  if (tool === 'browse_act') {
    const input = actionInput.parse(params);
    if (input.action === 'tab_new' && input.url) parsePublicHttpUrl(input.url);
  }
}

export const securityHook = {
  name: 'security',
  priority: 1,
  async beforeToolCall(ctx, tool, params) {
    try {
      validateInput(tool, params);
      return { action: 'allow' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ctx.toolCtx.stepCount++;
      pushWanderStep(ctx.toolCtx, {
        timestamp: new Date().toISOString(), tool, status: 'blocked', thought: `安全护栏拒绝: ${reason}`,
      });
      return { action: 'deny', reason };
    }
  },
} satisfies HookDefinition;
