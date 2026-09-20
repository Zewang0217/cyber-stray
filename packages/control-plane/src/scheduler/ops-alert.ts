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
