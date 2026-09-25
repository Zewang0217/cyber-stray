/**
 * 运维告警外呼（#275 首推 24h 未送达；接口面与 #267 告警票对齐）
 *
 * #267 未合，此处只留最小接口：飞书 bot webhook 文本消息。#267 落地后
 * 告警通道收口到它的配置与格式，本模块随之并入或删除。
 */

/** 注入式 fetch（测试）；缺省全局 fetch */
export type AlertFetchFn = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 发送一条文本告警。失败抛错（调用方决定 log-and-continue 还是重试）——
 * 不兜底吞掉：告警发不出去本身就是需要人看见的故障。
 */
export async function sendOpsAlert(
  webhookUrl: string,
  text: string,
  fetchFn: AlertFetchFn = fetch,
): Promise<void> {
  const res = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } }),
  });
  if (!res.ok) {
    throw new Error(`告警 webhook 响应 ${res.status}`);
  }
}

// ---------- 去重外呼（#267） ----------

/** 同 key 去重窗口：10 分钟内只发一条，防连败/反复失败刷屏 */
export const OPS_ALERT_DEDUP_TTL_MS = 10 * 60 * 1000;

const dedupLastSent = new Map<string, number>();

/**
 * 带去重的外呼（#267）：同 key 在窗口内只发一条。
 * 发送成功才记窗口——发送失败不占窗口，下次触发立即重试（告警发不出去
 * 本身就是故障，不能被去重吞掉）；连发失败由调用方 log-and-continue。
 *
 * @returns 本次是否真正发出（false = 窗口内被去重）
 */
export async function sendOpsAlertDedup(
  webhookUrl: string,
  key: string,
  text: string,
  fetchFn: AlertFetchFn = fetch,
  now: () => number = Date.now,
): Promise<boolean> {
  const last = dedupLastSent.get(key);
  if (last !== undefined && now() - last < OPS_ALERT_DEDUP_TTL_MS) return false;
  await sendOpsAlert(webhookUrl, text, fetchFn);
  dedupLastSent.set(key, now());
  return true;
}

/** 重置去重窗口（测试隔离） */
export function _resetOpsAlertDedup(): void {
  dedupLastSent.clear();
}
