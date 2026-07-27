/**
 * browser_skill_list - 列出所有已索引的浏览器 Skill
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../../logger.js';
import { pushWanderStep, type ToolContext } from '../../registry/context.js';
import type { ToolDefinition } from '../../tool-manager.js';
import { getSkillIndex } from './skill-index.js';

const logger = consola.withTag('tool:browser_skill_list');

const DESCRIPTION = '列出所有可用的浏览器操作 Skill（名称 + 描述）';

export const browserSkillListToolDef: ToolDefinition = {
  metadata: {
    name: 'browser_skill_list',
    description: DESCRIPTION,
    category: 'browser',
  },
  createTool: (ctx: ToolContext) => tool({
    description: DESCRIPTION,
    inputSchema: z.object({}),
    execute: async () => {
      ctx.stepCount++;

      try {
        const index = getSkillIndex();
        const skills = index.list().map((e) => ({
          name: e.name,
          description: e.description,
        }));

        logger.info(`[${ctx.traceId}] TOOL browser_skill_list [count=${skills.length}]`);

        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'browser_skill_list',
          thought: `列出浏览器 Skill（${skills.length} 个）`,
        });

        return { skills };
      } catch (error) {
        logger.error(`[${ctx.traceId}] TOOL browser_skill_list ERROR`, { error });
        return { error: String(error) };
      }
    },
  }),
};
