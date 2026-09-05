/**
 * Quality Hook — speak 护栏（P3 #152：门控从评分防火墙 → 反馈抽样器）
 *
 * speak 是否推送由 LLM 在 ReAct 循环内自判断（可保持沉默），本 hook 不再做
 * 价值评分与阈值 deny。beforeToolCall 只做确定性工作：
 * - 内容扫描：prompt injection 特征 → deny（安全红线，不交给 LLM 判断）；
 *   URL 数量异常 → 警告随 gateReasons 落盘（价值判断仍归 LLM）
 * - 护栏：每游荡 speak 上限 / URL 冷却期 → deny + planLimited 留痕
 *   （内容落盘不丢，供仪表盘解释；与日预算 planLimited 同标记，原因见 reasons）
 * - 话题归因：内容命中的图谱话题写入 ctx.matchedTopics（S2 Phase A 反馈归因）
 *
 * afterToolCall：推送成功记录 URL；附加归因信息到结果；发 speak 事件。
 */

import type { HookDefinition } from './types.js';
import {
  DEFAULT_PUSH_GATE_CONFIG,
  attributeTopics,
  scanContentWarnings,
  type SpeakType,
} from '../memory/push-gate.js';
import { extractUrl, addVisitedUrl, isInCooldown } from '../tools/dedup/url-tracker.js';
import { pushWanderStep } from '../tools/registry/context.js';
import { recordGatedSpeak } from '../tools/push/speak.js';
import type { HookContext } from './types.js';
import { consola } from '../logger.js';

const logger = consola.withTag('hook:quality');

/**
 * speak deny 的统一留痕（复用旧门控拦截路径的不变量维护）：
 * stepCount/wanderHistory 照常维护，历史记录落盘（gated 或 planLimited），
 * ctx.spokeTimes 不自增——被拦的内容不算推送。
 */
async function denySpeak(
  ctx: HookContext,
  content: string,
  type: SpeakType,
  reason: string,
  recordMeta: { gated?: boolean; planLimited?: boolean; gateReasons?: string[] },
): Promise<{ action: 'deny'; reason: string }> {
  logger.info(`[${ctx.traceId}] speak 被护栏拦截: ${reason}`);

  ctx.toolCtx.stepCount++;
  pushWanderStep(ctx.toolCtx, {
    timestamp: new Date().toISOString(),
    tool: 'speak',
    spoke: content,
    thought: `[${type}] 内容被护栏拦截 (${reason})`,
  });

  await recordGatedSpeak(content, type, {
    mood: ctx.toolCtx.state.mood,
    gateReasons: recordMeta.gateReasons,
    ...(recordMeta.gated ? { gated: true } : {}),
    ...(recordMeta.planLimited ? { planLimited: true } : {}),
  });

  // F8：speak 事件（deny 路径不经过 afterToolCall，需在此显式发）
  ctx.emit({
    type: 'speak',
    content: String(content).slice(0, 200),
    speakType: type,
    gated: true,
  });

  return { action: 'deny', reason };
}

export const qualityHook = {
  name: 'quality',
  priority: 100,

  async beforeToolCall(ctx, tool, params) {
    if (tool !== 'speak') return { action: 'allow' };

    const pg = { ...DEFAULT_PUSH_GATE_CONFIG, ...ctx.config.pushGate };
    if (!pg.enabled) return { action: 'allow' };

    const { content, type } = params as { content: string; type: string };

    // 先清上一轮残留：护栏走 deny 时，不能把上个内容的归因/理由透传给本次
    ctx.toolCtx.gateReasons = undefined;
    ctx.toolCtx.matchedTopics = undefined;

    // 1. 内容扫描（确定性安全护栏）
    const scan = scanContentWarnings(content, pg.contentScan);
    if (scan.hasInjection) {
      return denySpeak(ctx, content, type as SpeakType, '检测到 prompt injection 特征', {
        gated: true,
        gateReasons: scan.warnings,
      });
    }

    // 2. 每游荡 speak 上限（防话痨护栏）
    if (pg.maxSpeaksPerWander > 0 && ctx.toolCtx.spokeTimes >= pg.maxSpeaksPerWander) {
      return denySpeak(
        ctx,
        content,
        type as SpeakType,
        `本次游荡 speak 已达上限 ${pg.maxSpeaksPerWander} 条`,
        {
          planLimited: true,
          gateReasons: [`每游荡推送上限 ${pg.maxSpeaksPerWander} 条已用完`],
        },
      );
    }

    // 3. URL 冷却期（同链短期内不重复推）
    const url = extractUrl(content);
    if (url && (await isInCooldown(url, ctx.config.urlCooldownDays))) {
      return denySpeak(ctx, content, type as SpeakType, 'URL 在冷却期内（已推送过）', {
        planLimited: true,
        gateReasons: [`URL 冷却中：${ctx.config.urlCooldownDays} 天内已推送过`],
      });
    }

    // 4. 话题归因（S2 Phase A：命中图谱话题随 speak 落盘，反馈按 messageId 反查）
    const matched = await attributeTopics(content);
    if (matched.length > 0) {
      ctx.toolCtx.matchedTopics = matched;
    }

    // URL 数量异常等非安全警告随 gateReasons 落盘（不拦截）
    if (scan.warnings.length > 0) {
      ctx.toolCtx.gateReasons = scan.warnings;
    }

    return { action: 'allow' };
  },

  async afterToolCall(ctx, tool, params, result) {
    if (tool !== 'speak') return { result };

    const { content, type } = params as { content: string; type?: string };
    const r = result as Record<string, unknown>;

    // 附加归因信息到结果（供 TUI/测试断言；落盘由 speak() 的 meta 承担）
    if (ctx.toolCtx.gateReasons) r.gateReasons = ctx.toolCtx.gateReasons;
    if (ctx.toolCtx.matchedTopics) r.matchedTopics = ctx.toolCtx.matchedTopics;

    // RFC #59 事件协议：speak 行为事件（护栏放行后才会到这里）
    ctx.emit({
      type: 'speak',
      content: String(content).slice(0, 200),
      speakType: type ?? 'unknown',
      gated: false,
    });

    // 推送成功后记录 URL 到去重系统
    if (r.pushed) {
      const url = extractUrl(content);
      if (url) {
        await addVisitedUrl(url, content).catch((err) => {
          logger.error('记录推送 URL 失败', { url, error: err });
        });
      }
    }

    return { result: r };
  },
} satisfies HookDefinition;
