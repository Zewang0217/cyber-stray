import webpush from 'web-push';
import { parsePushEndpoint, requestPublicUrl } from '@cyber-stray/shared/outbound';

/** 向浏览器订阅投递加密通知。 */
export async function sendPublicNotification(endpoint: string, payload: unknown, keys: { p256dh: string; auth: string }): Promise<void> {
  parsePushEndpoint(endpoint);
  // 保留标准 Web Push 加密/VAPID，只将网络连接交给共享安全边界。
  const details = webpush.generateRequestDetails({ endpoint, keys }, JSON.stringify(payload));
  const response = await requestPublicUrl(endpoint, {
    method: 'POST',
    headers: Object.fromEntries(Object.entries(details.headers).map(([key, value]) => [key, String(value)])),
    body: details.body,
    timeoutMs: 10_000,
    maxBytes: 64 * 1024,
  });
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error(`Web Push 投递失败: HTTP ${response.status}`), { statusCode: response.status });
  }
}
