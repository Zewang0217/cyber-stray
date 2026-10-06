import type { SpeakType } from '@cyber-stray/shared/push';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { consola } from '../../logger.js';
import { getConfig, getDataPath } from '../../config.js';
import { localHour, withinPushWindow, countGatePassedToday, todaySpeaksFile } from './push-budget.js';
import { sendFeishuMessage } from './lark-sender.js';
import { registerSpeakTopics } from '../../memory/feedback-pipeline.js';
import { buildSpeakRecord, type SpeakRecord, type SpeakRecordMeta } from './history-record.js';
import type { Mood } from '../../types.js';
import { randomUUID } from 'node:crypto';

const logger = consola.withTag('speak');

/** speak 内容类型契约在 shared/push（push-gate、CP、web 同源） */
export type { SpeakType };

/** speak 工具入参 */
export interface SpeakInput {
  content: string;
  type: SpeakType;
}

/** speak 工具返回值 */
export interface SpeakResult {
  contentId?: string;
  success: boolean;
  /**
   * 是否经 agent 直连渠道（飞书/Telegram）投递。租户（SaaS）模式下直连渠道
   * 不配置，恒为 false 属**预期**——主人侧的真实送达由控制面 push-gateway 的
   * Web Push 负责（#77 默认通道；语义澄清 #178）。不要用它判断「主人是否收到」。
   */
  pushed: boolean;
  /** 是否被推送门控拦截 */
  gated?: boolean;
  /** 门控评分 */
  gateScore?: number;
  /** 门控理由 */
  gateReasons?: string[];
  timestamp: string;
  messageId?: string; // 飞书消息 ID（用于关联反馈）
  error?: string;      // 推送失败时的错误信息
}

/**
 * 追加到推送历史记录文件
 */
async function appendSpeakHistory(record: SpeakRecord): Promise<void> {
  // 这是 Web Push 交付及反馈归因的真相源，不能当作可丢弃日志。
  const historyDir = getDataPath('history');
  await mkdir(historyDir, { recursive: true });
  const filename = join(historyDir, todaySpeaksFile());
  await appendFile(filename, JSON.stringify(record) + '\n', 'utf-8');
}

/**
 * 记录一条被推送门控拦截的内容
 *
 * 门控拦截发生在 speak() 之前，走不到正常的历史写入路径。但"学了什么却没告诉
 * 主人"同样是需要留痕的信息，仪表盘据此展示"仅学习"状态。
 */
export async function recordGatedSpeak(
  content: string,
  type: SpeakType,
  meta: SpeakRecordMeta = {},
): Promise<void> {
  await appendSpeakHistory(
    buildSpeakRecord(content, type, false, new Date().toISOString(), {
      ...meta,
      gated: true,
    }),
  );
}

/**
 * 推送到 Telegram
 */
async function pushToTelegram(content: string): Promise<string> {
  const cfg = getConfig();
  const token = cfg.telegramBotToken;
  const chatId = cfg.telegramChatId;

  if (!token || !chatId) {
    throw new Error('未配置 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID');
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: content,
    parse_mode: 'HTML',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Telegram 推送失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (!data.ok) {
    throw new Error(`Telegram 推送失败: ${data.description ?? '未知错误'}`);
  }
  return data.result?.message_id ? String(data.result.message_id) : '';
}

/**
 * speak 工具：表达（分享链接、碎碎念、写文章）
 *
 * 会尝试推送到所有已配置的渠道（飞书、Telegram）。
 * 推送失败时记录错误但不中断 ReAct Loop（返回 pushed: false）。
 *
 * 飞书发送方式根据 feishu.pushMode 配置：
 * - lark_channel: 使用 LarkChannel（默认）
 * - webhook: 使用传统 Webhook
 */
export async function speak(
  content: string,
  type: SpeakType,
  meta: {
    mood?: Mood;
    gateScore?: number;
    gateReasons?: string[];
    matchedTopics?: string[];
  } = {},
): Promise<SpeakResult> {
  const timestamp = new Date().toISOString();
  const contentId = randomUUID();

  logger.info('speak 调用', { type, contentLength: content.length });

  // 内容长度检查
  if (!content.trim()) {
    logger.warn('speak 内容为空');
    return {
      success: false,
      pushed: false,
      timestamp,
      error: '内容不能为空',
    };
  }

  // share 类型建议包含 URL（软检查，不强制）
  if (type === 'share' && !content.includes('http')) {
    logger.warn('share 类型的内容不包含 URL', { content: content.slice(0, 50) });
  }
  const cfg = getConfig();
  // S11 套餐门控：日预算 + 推送窗口（控制面注入 plan；未注入 = 单用户
  // 模式不设限）。只卡"到达主人"，学习照常——超限内容落盘标 planLimited。
  const plan = cfg.plan;
  let planLimited = false;
  if (plan) {
    const hour = localHour();
    if (!withinPushWindow(hour, plan.pushWindowStart, plan.pushWindowEnd)) {
      planLimited = true;
      logger.info('推送窗口外，内容仅记录', { hour, window: [plan.pushWindowStart, plan.pushWindowEnd] });
    } else if (plan.pushesPerDay > 0) {
      const used = await countGatePassedToday(getDataPath(`history/${todaySpeaksFile()}`));
      if (used >= plan.pushesPerDay) {
        planLimited = true;
        logger.info('日推送预算已满，内容仅记录', { used, limit: plan.pushesPerDay });
      }
    }
  }
  if (planLimited) {
    await appendSpeakHistory(
      buildSpeakRecord(content, type, false, timestamp, {
        ...meta,
        contentId,
        planLimited: true,
      }),
    );
    return {
      success: true,
      contentId,
      pushed: false,
      timestamp,
    };
  }

  let pushed = false;
  let messageId: string | undefined;
  const channelMessageIds: NonNullable<SpeakRecord['channelMessageIds']> = {};
  const pushErrors: string[] = [];

  // 推送到飞书（根据配置选择方式）
  if (cfg.feishu?.pushMode === 'lark_channel' && cfg.larkAppId && cfg.larkAppSecret) {
    // LarkChannel 方式
    try {
      messageId = await sendFeishuMessage(content);
      channelMessageIds.feishu = messageId;
      pushed = true;
      logger.success('飞书（LarkChannel）推送成功', { messageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrors.push(`飞书: ${message}`);
      logger.error('飞书（LarkChannel）推送失败', { error: message });
    }
  } else if (cfg.feishuWebhook) {
    // Webhook 方式
    try {
      messageId = await sendFeishuMessage(content);
      channelMessageIds.feishu = messageId;
      pushed = true;
      logger.success('飞书（Webhook）推送成功', { messageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrors.push(`飞书: ${message}`);
      logger.error('飞书（Webhook）推送失败', { error: message });
    }
  }

  // 尝试推送到 Telegram
  if (cfg.telegramBotToken && cfg.telegramChatId) {
    try {
      const tgMessageId = await pushToTelegram(content);
      channelMessageIds.telegram = tgMessageId;
      pushed = true;
      // 飞书未回 ID 或未配置飞书时，用 Telegram message_id 做反馈归因
      if (!messageId) messageId = tgMessageId || undefined;
      logger.success('Telegram 推送成功');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrors.push(`Telegram: ${message}`);
      logger.error('Telegram 推送失败', { error: message });
    }
  }

  // 没有配置任何直连渠道：内容照常落 speaks 历史，pushed=false 属预期——
  // 租户模式的送达由 CP push-gateway 读 speaks 历史经 Web Push 完成（#178），
  // 这里不是故障分支，不要告警
  if (!(cfg.larkAppId && cfg.larkAppSecret) && !cfg.feishuWebhook && !(cfg.telegramBotToken && cfg.telegramChatId)) {
    logger.info('无直连渠道配置，内容落历史（送达由 CP Web Push 网关负责）', { content });
  }

  // #114 反馈归因：内容包含扫描命中的口头禅（LLM 自由发挥，文本包含即
  // 视为用过——粗粒度但可解释；落盘供反馈时按 messageId 反查）
  const matchedCatchphrases = (cfg.catchphrases ?? [])
    .filter((c) => content.includes(c.text))
    .map((c) => c.text);

  // 记录到历史文件
  await appendSpeakHistory(
    buildSpeakRecord(content, type, pushed, timestamp, {
      contentId,
      channelMessageIds,
      messageId,
      mood: meta.mood,
      gateScore: meta.gateScore,
      gateReasons: meta.gateReasons,
      matchedTopics: meta.matchedTopics,
      matchedCatchphrases,
    }),
  );

  // Phase 3: 注册消息-兴趣映射，供后续反馈强化。
  // 用门控算出的实际命中话题，而非图谱 Top N——后者与内容无关，会导致每次
  // 反馈等量强化所有节点，权重占比恒定不变，兴趣图谱永远无法分化。
  if (meta.matchedTopics?.length) {
    registerSpeakTopics(contentId, meta.matchedTopics);
    for (const id of Object.values(channelMessageIds)) {
      registerSpeakTopics(id, meta.matchedTopics);
    }
  }

  const result: SpeakResult = {
    contentId,
    success: true,
    pushed,
    timestamp,
    messageId,
  };

  if (pushErrors.length > 0 && !pushed) {
    result.error = pushErrors.join('; ');
  }

  logger.info('speak 完成', { type, pushed, messageId, hasErrors: pushErrors.length > 0 });

  return result;
}
