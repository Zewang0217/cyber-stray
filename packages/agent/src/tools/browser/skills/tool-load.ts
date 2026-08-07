/**
 * browser_skill_load - 加载指定浏览器 Skill 的完整内容
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../../logger.js';
import { pushWanderStep, type ToolContext } from '../../registry/context.js';
import type { ToolDefinition } from '../../tool-manager.js';
import { getSkillIndex } from './skill-index.js';

const logger = consola.withTag('tool:browser_skill_load');

const DESCRIPTION = '加载指定浏览器 Skill 的完整内容（frontmatter + Markdown 正文）';

export const browserSkillLoadToolDef: ToolDefinition = {
  metadata: {
    name: 'browser_skill_load',
    description: DESCRIPTION,
    category: 'browser',
  },
  createTool: (ctx: ToolContext) => tool({
    description: DESCRIPTION,
    inputSchema: z.object({
      name: z.string().describe('Skill 名称'),
    }),
    execute: async ({ name }) => {
      ctx.stepCount++;

      try {
        const index = getSkillIndex();
        const skill = index.load(name);

        if (!skill) {
          logger.warn(`[${ctx.traceId}] TOOL browser_skill_load [name=${name}] not found`);
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'browser_skill_load',
            thought: `加载 Skill "${name}" 失败：不存在`,
          });
          return { error: `Skill "${name}" 不存在` };
        }

        logger.info(`[${ctx.traceId}] TOOL browser_skill_load [name=${name}]`);

        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'browser_skill_load',
          thought: `加载 Skill "${name}"`,
        });

        return {
          name: skill.meta.name,
          description: skill.meta.description,
          state: skill.meta.state,
          content: skill.content,
          filePath: skill.filePath,
        };
      } catch (error) {
        logger.error(`[${ctx.traceId}] TOOL browser_skill_load ERROR [name=${name}]`, { error });
        return { error: String(error) };
      }
    },
  }),
};
