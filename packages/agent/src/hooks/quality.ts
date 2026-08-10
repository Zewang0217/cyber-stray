/**
 * Quality Hook — 推送价值门控（PushGate）
 *
 * 迁移自 speak.ts 的 PushGate 逻辑（L41-88, L94-115）。
 * beforeToolCall：评估门控，不通过则 deny（返回 gated 结果）。
 * afterToolCall：附加门控分数、记录 URL、触发校准。
 */

import type { HookDefinition } from './types.js';
import { getPushGate, type SpeakType } from '../memory/push-gate.js';
import { extractUrl, addVisitedUrl } from '../tools/dedup/url-tracker.js';
import { pushWanderStep } from '../tools/registry/context.js';
import { recordGatedSpeak } from '../tools/push/speak.js';
import { consola } from '../logger.js';

const logger = consola.withTag('hook:quality');

export const qualityHook = {
  name: 'quality',
  priority: 100,

  async beforeToolCall(ctx, tool, params) {
    if (tool !== 'speak') return { action: 'allow' };

    const { content, type } = params as { content: string; type: string };
    const gate = getPushGate(ctx.config.pushGate);

    try {
      const gateResult = await gate.evaluate(content, type as SpeakType);

      // 存储分数供 afterToolCall 使用
      ctx.data['quality:gateScore'] = gateResult.score;
      ctx.data['quality:gateReasons'] = gateResult.reasons;
      // 实际命中的兴趣话题 → 供 speak() 反馈归因（与工具共享同一 toolCtx）
      ctx.toolCtx.matchedTopics = gateResult.matchedTopics;

      if (!gateResult.passed) {
        logger.info(
          `[${ctx.traceId}] speak 被门控拦截 [type=${type} score=${gateResult.score.toFixed(2)} threshold=${gateResult.threshold.toFixed(2)}]`,
        );

        // 门控拦截时也记录 URL 去重（避免 LLM 反复尝试推同一链接）
        const url = extractUrl(content);
        if (url) {
          await addVisitedUrl(url, content).catch((err) => {
            logger.error('记录门控 URL 失败', { url, error: err });
          });
        }

        // 维护 stepCount 和 wanderHistory（原 speak.ts 行为）
        ctx.toolCtx.stepCount++;
        pushWanderStep(ctx.toolCtx, {
          timestamp: new Date().toISOString(),
          tool: 'speak',
          spoke: content,
          thought: `[${type}] 内容被门控拦截 (score=${gateResult.score.toFixed(2)})`,
        });

        // 留痕"学了但没推"，供仪表盘展示；ctx.spokeTimes 不自增——
        // 它会累加进 state.totalPushes，被拦截的内容不算推送。
        await recordGatedSpeak(content, type as SpeakType, {
          mood: ctx.toolCtx.state.mood,
          gateScore: gateResult.score,
        });

        // F8：gated:true 的 speak 事件（deny 路径不经过 afterToolCall，需在此显式发）
        ctx.emit({
          type: 'speak',
          content: String(content).slice(0, 200),
          speakType: type,
          gated: true,
          score: gateResult.score,
        });

        return {
          action: 'deny',
          reason: `PushGate score ${gateResult.score.toFixed(2)} < threshold`,
          result: {
            success: true,
            pushed: false,
            gated: true,
            gateScore: gateResult.score,
            gateReasons: gateResult.reasons,
            timestamp: new Date().toISOString(),
          },
        };
      }
    } catch (error) {
      // 门控失败不阻断 speak——默认放行
      logger.warn(`[${ctx.traceId}] PushGate 评估失败，默认放行`, { error });
    }

    return { action: 'allow' };
  },

  async afterToolCall(ctx, tool, params, result) {
    if (tool !== 'speak') return { result };

    const { content } = params as { content: string };
    const gateScore = ctx.data['quality:gateScore'] as number | undefined;
    const gateReasons = ctx.data['quality:gateReasons'] as string[] | undefined;

    const r = result as Record<string, unknown>;

    // 附加门控信息到结果
    if (gateScore !== undefined) {
      r.gateScore = gateScore;
      r.gateReasons = gateReasons;
    }

    // RFC #59 事件协议：speak 行为事件（门控放行后才会到这里）
    const speakType = params && typeof params === 'object' && 'type' in params && typeof params.type === 'string'
      ? params.type
      : 'unknown';
    ctx.emit({
      type: 'speak',
      content: String(content).slice(0, 200),
      speakType,
      gated: false,
      score: gateScore,
    });

    // 推送成功后记录 URL 到去重系统 + 触发校准
    if (r.pushed) {
      const url = extractUrl(content);
      if (url) {
        await addVisitedUrl(url, content).catch((err) => {
          logger.error('记录推送 URL 失败', { url, error: err });
        });
      }

      const gate = getPushGate(ctx.config.pushGate);
      gate.calibrate().catch((err) => {
        logger.warn('阈值校准失败', { err });
      });
    }

    return { result: r };
  },
} satisfies HookDefinition;
