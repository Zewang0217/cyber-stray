/**
 * browse_act - 在浏览器中执行交互操作
 *
 * 按 action 分发到 agent-browser CLI：
 * click / fill / type / press / scroll / find / wait / back / tab
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../../logger.js';
import { pushWanderStep, type ToolContext } from '../../registry/context.js';
import type { ToolDefinition } from '../../tool-manager.js';
import { getBrowserExecutor } from '../executor.js';
import { updateBrowserContext } from '../lifecycle.js';

const logger = consola.withTag('tool:browse_act');

const DESCRIPTION =
  '在浏览器中执行交互操作。先用 browse_snapshot 获取页面元素 ref（如 @e1），再用此工具操作。';

const inputSchema = z.object({
  action: z
    .enum([
      'click',
      'fill',
      'type',
      'press',
      'scroll',
      'find_click',
      'find_fill',
      'wait',
      'back',
      'tab_list',
      'tab_new',
      'tab_switch',
      'tab_close',
    ])
    .describe('要执行的操作类型'),
  selector: z.string().optional().describe('元素 ref（如 @e1）或 CSS 选择器'),
  text: z.string().optional().describe('填写/输入的文本'),
  key: z.string().optional().describe('按键名（如 Enter, Tab, Escape）'),
  direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('滚动方向'),
  pixels: z.number().optional().describe('滚动像素数'),
  locatorType: z.string().optional().describe('语义定位类型（text/label/role/placeholder）'),
  locatorValue: z.string().optional().describe('语义定位值'),
  condition: z.string().optional().describe('等待条件（文本/URL 模式/毫秒数）'),
  url: z.string().optional().describe('新标签页 URL'),
  tabId: z.string().optional().describe('标签页 ID（如 t1, t2）'),
});

type BrowseActInput = z.infer<typeof inputSchema>;

/** 解析结果：要么映射出 CLI 命令，要么返回参数错误 */
type Resolved =
  | { ok: true; command: string; args: string[] }
  | { ok: false; error: string };

/** 校验必填参数并把 action 映射到 agent-browser CLI 命令 */
function resolveCommand(input: BrowseActInput): Resolved {
  const { action, selector, text, key, direction, pixels, locatorType, locatorValue, condition, url, tabId } =
    input;

  switch (action) {
    case 'click':
      if (!selector) return { ok: false, error: 'click 需要 selector 参数' };
      return { ok: true, command: 'click', args: [selector] };

    case 'fill':
      if (!selector) return { ok: false, error: 'fill 需要 selector 参数' };
      if (text === undefined) return { ok: false, error: 'fill 需要 text 参数' };
      return { ok: true, command: 'fill', args: [selector, text] };

    case 'type':
      if (!selector) return { ok: false, error: 'type 需要 selector 参数' };
      if (text === undefined) return { ok: false, error: 'type 需要 text 参数' };
      return { ok: true, command: 'type', args: [selector, text] };

    case 'press':
      if (!key) return { ok: false, error: 'press 需要 key 参数' };
      return { ok: true, command: 'press', args: [key] };

    case 'scroll':
      return { ok: true, command: 'scroll', args: [direction ?? 'down', String(pixels ?? 300)] };

    case 'find_click':
      if (!locatorType) return { ok: false, error: 'find_click 需要 locatorType 参数' };
      if (!locatorValue) return { ok: false, error: 'find_click 需要 locatorValue 参数' };
      return { ok: true, command: 'find', args: [locatorType, locatorValue, 'click'] };

    case 'find_fill':
      if (!locatorType) return { ok: false, error: 'find_fill 需要 locatorType 参数' };
      if (!locatorValue) return { ok: false, error: 'find_fill 需要 locatorValue 参数' };
      if (text === undefined) return { ok: false, error: 'find_fill 需要 text 参数' };
      return { ok: true, command: 'find', args: [locatorType, locatorValue, 'fill', text] };

    case 'wait':
      if (!condition) return { ok: false, error: 'wait 需要 condition 参数' };
      return { ok: true, command: 'wait', args: [condition] };

    case 'back':
      return { ok: true, command: 'back', args: [] };

    case 'tab_list':
      return { ok: true, command: 'tab', args: [] };

    case 'tab_new':
      return { ok: true, command: 'tab', args: ['new', ...(url ? [url] : [])] };

    case 'tab_switch':
      if (!tabId) return { ok: false, error: 'tab_switch 需要 tabId 参数' };
      return { ok: true, command: 'tab', args: [tabId] };

    case 'tab_close':
      return { ok: true, command: 'tab', args: ['close', ...(tabId ? [tabId] : [])] };
  }
}

export const browseActToolDef: ToolDefinition = {
  metadata: {
    name: 'browse_act',
    description: DESCRIPTION,
    category: 'browser',
  },
  createTool: (ctx: ToolContext) =>
    tool({
      description: DESCRIPTION,
      inputSchema,
      execute: async (input) => {
        ctx.stepCount++;

        const resolved = resolveCommand(input);
        if (!resolved.ok) {
          logger.warn(`[${ctx.traceId}] TOOL browse_act [action=${input.action}] 参数错误: ${resolved.error}`);
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'browse_act',
            thought: `${input.action} 参数错误: ${resolved.error}`,
          });
          return { error: resolved.error };
        }

        const executor = getBrowserExecutor();
        const result = await executor.execute(resolved.command, resolved.args);

        if (!result.success) {
          logger.warn(
            `[${ctx.traceId}] TOOL browse_act [action=${input.action}] 失败: ${result.error}`,
          );
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'browse_act',
            thought: `${input.action} 失败: ${result.error}`,
          });
          return { error: result.error ?? '操作执行失败' };
        }

        logger.info(`[${ctx.traceId}] TOOL browse_act [action=${input.action}] 成功`);

        // tab 操作后同步 openTabs 到 BrowserContext
        if (['tab_list', 'tab_new', 'tab_switch', 'tab_close'].includes(input.action)) {
          const tabs = result.data?.tabs as Array<{ tabId: string; title: string; url: string; active: boolean }> | undefined;
          if (tabs) {
            updateBrowserContext({ openTabs: tabs });
          }
        }

        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'browse_act',
          thought: `执行: ${input.action}`,
        });

        return result.data ?? { success: true };
      },
    }),
};
