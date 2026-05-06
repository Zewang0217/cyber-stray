import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { recordObservation } from '../../memory/long-term.js';
import { tryUpdateUserProfile } from '../../memory/user-profile.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:observe_user');

/** 观察记录标题截断长度 */
const OBSERVATION_TITLE_MAX = 60;
/** 日志中观察摘要截断长度 */
const OBSERVATION_LOG_MAX = 80;

export function createObserveUserTool(ctx: ToolContext) {
  return tool({
    description: `观察主人的行为模式并记录。用于积累对主人的理解，帮助未来更好地服务。

**使用时机：**
- 注意到主人对某类内容表现出明确的兴趣或不感兴趣
- 发现主人的互动习惯或偏好模式
- 主人明确表达了喜欢或不喜欢某个话题

**不应使用：**
- 单次点击不等于长期兴趣，不要过度解读
- 主人沉默或不回应不等于不喜欢
- 不要在每一步都调用，只在注意到值得记录的行为模式时才用

**画像调整（profile_change）：**
只在观察到"非常明确"的强信号时才提议，例如：
- 主人连续多次对同类内容表现出喜欢
- 主人明确说"我喜欢/讨厌 X"
- 你发现了一个反复出现的行为模式

注意：画像调整有 30 分钟冷却期，如果被拒绝会在返回信息中告知。调整要谨慎，宁缺毋滥。`,
    inputSchema: z.object({
      observation: z.string().describe('观察到的用户行为或模式，尽量具体'),
      profile_change: z
        .object({
          type: z.enum(['like', 'dislike']).describe('偏好类型'),
          topic: z.string().describe('话题或内容类型'),
          reasoning: z.string().describe('为什么认为这是稳定的偏好，基于什么证据'),
        })
        .nullable()
        .optional()
        .describe('可选：当有非常明确的强信号时，提议 1 条画像调整'),
    }),
    execute: async ({ observation, profile_change }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] observe_user`, {
        observationLength: observation.length,
        hasProfileChange: !!profile_change,
      });

      // 1. 始终保存观察
      let observationResult;
      try {
        const entry = await recordObservation({
          title: observation.substring(0, OBSERVATION_TITLE_MAX),
          content: observation,
          tags: ['agent-observed'],
        });
        observationResult = { saved: true, id: entry.id };
      } catch (error) {
        logger.error('observe_user 保存观察失败', { error });
        observationResult = { saved: false, error: String(error) };
      }

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'observe_user',
        thought: `观察: ${observation.substring(0, OBSERVATION_LOG_MAX)}`,
      });

      // 2. 如果有画像调整提议，尝试执行
      let profileResult = null;
      if (profile_change) {
        const result = await tryUpdateUserProfile(
          profile_change.type,
          profile_change.topic,
          profile_change.reasoning,
        );

        profileResult = result.success
          ? { accepted: true }
          : { accepted: false, reason: result.reason };

        if (result.success) {
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'observe_user',
            thought: `画像更新: ${profile_change.type} ${profile_change.topic} — ${profile_change.reasoning}`,
          });
        }
      }

      return {
        observation: observationResult,
        profile_change: profileResult,
      };
    },
  });
}
