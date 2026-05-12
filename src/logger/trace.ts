/**
 * traceId 生成器
 *
 * 格式: wander-{HHmmss}-{random4}
 * 示例: wander-143022-a7f3
 */

/**
 * 生成随机 4 位十六进制字符串
 */
function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * 生成 traceId
 */
export function generateTraceId(): string {
  const now = new Date();
  const timePart = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');

  return `wander-${timePart}-${randomHex(4)}`;
}
