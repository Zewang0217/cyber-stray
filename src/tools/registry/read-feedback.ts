/**
 * 读取用户反馈工具
 *
 * Agent 使用此工具读取用户通过飞书卡片提交的反馈
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { pushWanderStep, type ToolContext } from './context.js';
import {
  getPendingFeedbacks,
  getFeedbackStats,
  markFeedbackProcessed,
  type Feedback,
} from '../../memory/feedback-store.js';

const logger = consola.withTag('tool:read_feedback');

/**
 * 创建读取反馈工具
 */
export function createReadFeedbackTool(ctx: ToolContext) {
  return tool({
    description:
      '读取用户通过飞书卡片按钮提交的反馈。在开始游荡前主动检查是否有待处理的反馈，了解用户喜好和意见。返回待处理的反馈列表和统计信息。',
    inputSchema: z.object({
      /** 限制返回数量 */
      limit: z.number().min(1).max(50).default(10).describe('最多返回多少条反馈'),
    }),
    execute: async ({ limit }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] read_feedback`, { limit });

      // 获取待处理反馈
      const feedbacks = await getPendingFeedbacks(limit);
      const stats = await getFeedbackStats();

      // 记录到上下文供后续使用
      ctx.pendingFeedbackCount = stats.pending;

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'read_feedback',
        thought: `发现 ${stats.pending} 条待处理反馈，${stats.likes} 条喜欢，${stats.dislikes} 条不喜欢`,
      });

      return {
        hasFeedback: feedbacks.length > 0,
        feedbacks: feedbacks.map((f) => ({
          id: f.id,
          type: f.type,
          timestamp: f.timestamp,
        })),
        stats: {
          pending: stats.pending,
          likes: stats.likes,
          dislikes: stats.dislikes,
          total: stats.total,
        },
        summary: `待处理: ${stats.pending} 条 | 👍 ${stats.likes} | 👎 ${stats.dislikes}`,
      };
    },
  });
}

/**
 * 创建处理反馈工具
 *
 * 用于标记反馈已处理并记录 Agent 的响应
 */
export function createProcessFeedbackTool(ctx: ToolContext) {
  return tool({
    description:
      '标记用户反馈为已处理。处理完成后调用此工具更新状态。',
    inputSchema: z.object({
      /** 反馈 ID */
      feedbackId: z.string().describe('要处理的反馈 ID'),
      /** Agent 对此反馈的响应（可选） */
      response: z.string().optional().describe('Agent 的响应或处理说明'),
    }),
    execute: async ({ feedbackId, response }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] process_feedback`, { feedbackId });

      const success = await markFeedbackProcessed(feedbackId, response);

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'process_feedback',
        thought: `已处理反馈 ${feedbackId}${response ? `: ${response}` : ''}`,
      });

      return {
        success,
        feedbackId,
        message: success
          ? `反馈 ${feedbackId} 已标记处理`
          : `处理失败，未找到反馈 ${feedbackId}`,
      };
    },
  });
}
