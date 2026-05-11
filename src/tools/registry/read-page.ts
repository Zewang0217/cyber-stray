import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { readPage } from '../page/reader.js';
import { pushWanderStep, type ToolContext } from './context.js';
import { getVisitedInfo, isInCooldown } from '../dedup/url-tracker.js';

const logger = consola.withTag('tool:read_page');

export function createReadPageTool(ctx: ToolContext) {
  return tool({
    description: '点开一个链接，阅读网页内容，看看里面有什么',
    inputSchema: z.object({
      url: z.string().url().describe('要阅读的网页地址'),
    }),
    execute: async ({ url }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] read_page`, { url });

      // 强制结束条件：精力过低
      if (ctx.state.energy < config.energyThreshold) {
        logger.warn('精力不足，跳过 read_page', { energy: ctx.state.energy });
        ctx.endReason = 'low_energy';
        return { url, title: '', content: '', links: [], error: '精力不足，无法继续游荡' };
      }

      // 检查 URL 是否在冷却期内
      const inCooldown = await isInCooldown(url, config.urlCooldownDays);
      const visitedInfo = await getVisitedInfo(url);

      const result = await readPage(url);

      if (result.error) {
        logger.warn('read_page 失败', { url, error: result.error });
      } else {
        ctx.visitedUrls.push(url);
      }

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'read_page',
        url,
        thought: result.error ? `读取失败: ${result.error}` : `读取: ${result.title}`,
      });

      // 如果 URL 在冷却期内，返回软提示
      if (inCooldown && visitedInfo) {
        return {
          ...result,
          visited: true,
          lastContent: visitedInfo.lastContent,
          message: `该 URL 之前已访问过。上次推送内容：${visitedInfo.lastContent || '无内容摘要'}`,
        };
      }

      return result;
    },
  });
}
