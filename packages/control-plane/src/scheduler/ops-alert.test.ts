/**
 * 运维告警去重测试（#267）——窗口内抑制 / 窗口外放行 / 失败不占窗口
 */

import { describe, expect, it, vi } from 'vitest';
import { _resetOpsAlertDedup, sendOpsAlertDedup } from './ops-alert.js';

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 200 }));
}

const BASE = 1_700_000_000_000;

describe('sendOpsAlertDedup（#267）', () => {
  it('首次发送；同 key 10 分钟内抑制；窗口外放行', async () => {
    _resetOpsAlertDedup();
    const fetchFn = okFetch();
    let now = BASE;

    expect(await sendOpsAlertDedup('http://hook', 'k1', 'a', fetchFn, () => now)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000; // 5 分钟：抑制
    expect(await sendOpsAlertDedup('http://hook', 'k1', 'b', fetchFn, () => now)).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 11 * 60 * 1000; // 距上次发送 16 分钟：放行
    expect(await sendOpsAlertDedup('http://hook', 'k1', 'c', fetchFn, () => now)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('不同 key 互不影响', async () => {
    _resetOpsAlertDedup();
    const fetchFn = okFetch();
    const now = () => BASE;
    expect(await sendOpsAlertDedup('http://hook', 'k1', 'a', fetchFn, now)).toBe(true);
    expect(await sendOpsAlertDedup('http://hook', 'k2', 'b', fetchFn, now)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('发送失败：抛错且不占窗口，下次触发立即重试', async () => {
    _resetOpsAlertDedup();
    const failFetch = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(sendOpsAlertDedup('http://hook', 'k1', 'a', failFetch, () => BASE)).rejects.toThrow();

    const okFetch2 = okFetch();
    expect(await sendOpsAlertDedup('http://hook', 'k1', 'b', okFetch2, () => BASE)).toBe(true);
    expect(okFetch2).toHaveBeenCalledTimes(1);
  });
});
