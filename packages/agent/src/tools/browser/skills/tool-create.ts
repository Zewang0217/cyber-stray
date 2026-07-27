/**
 * browser_skill_create - 创建或更新浏览器 Skill
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../../logger.js';
import { pushWanderStep, type ToolContext } from '../../registry/context.js';
import type { ToolDefinition } from '../../tool-manager.js';
import { getSkillIndex } from './skill-index.js';

const logger = consola.withTag('tool:browser_skill_create');

const MAX_CONTENT_BYTES = 10 * 1024; // 10KB

const DESCRIPTION = `创建或更新浏览器操作 Skill。

- name 格式：小写字母、数字、连字符，最长 64 字符
- 同名 Skill 已存在时自动走更新路径（替换正文）
- content 最大 10KB`;

export const browserSkillCreateToolDef: ToolDefinition = {
  metadata: {
    name: 'browser_skill_create',
    description: DESCRIPTION,
    category: 'browser',
  },
  createTool: (ctx: ToolContext) => tool({
    description: DESCRIPTION,
    inputSchema: z.object({
      name: z.string().describe('Skill 名称（小写字母、数字、连字符，最长 64 字符）'),
      description: z.string().describe('Skill 描述（最长 200 字符）'),
      content: z.string().describe('Skill 正文（Markdown，最大 10KB）'),
    }),
    execute: async ({ name, description, content }) => {
      ctx.stepCount++;

      // ── 输入校验 ──
      if (!description || description.trim().length === 0) {
        return { error: 'description 不能为空' };
      }
      if (description.length > 200) {
        return { error: 'description 超过 200 字符限制' };
      }
      if (Buffer.byteLength(content, 'utf-8') > MAX_CONTENT_BYTES) {
        return { error: 'content 超过 10KB 限制' };
      }

      try {
        const index = getSkillIndex();

        if (index.has(name)) {
          // patch 路径
          index.patch(name, content);
          const loaded = index.load(name);
          const path = loaded?.filePath ?? '';

          logger.info(`[${ctx.traceId}] TOOL browser_skill_create PATCH [name=${name}]`);
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'browser_skill_create',
            thought: `更新 Skill "${name}"`,
          });

          return { updated: true, path };
        }

        // create 路径
        const path = index.create(name, description, content);

        logger.info(`[${ctx.traceId}] TOOL browser_skill_create CREATE [name=${name}]`);
        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'browser_skill_create',
          thought: `创建 Skill "${name}"`,
        });

        return { created: true, path };
      } catch (error) {
        logger.error(`[${ctx.traceId}] TOOL browser_skill_create ERROR [name=${name}]`, { error });
        return { error: String(error) };
      }
    },
  }),
};
