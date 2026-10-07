import { describe, expect, it } from 'vitest';
import { normalizeRecord } from './history-view.js';

const base = { content: '来源文章', timestamp: '2026-10-04T10:00:00Z', type: 'share' };

describe('明信片展示与反馈 ID', () => {
  it('纯 Web Push 的内容 ID 可反馈，旧渠道 ID 仍兼容', () => {
    expect(normalizeRecord({ ...base, contentId: 'content-1' })?.messageId).toBe('content-1');
    expect(normalizeRecord({ ...base, contentId: 'content-1', messageId: 'channel-1' })?.messageId).toBe('content-1');
    expect(normalizeRecord({ ...base, messageId: 'legacy-1' })?.messageId).toBe('legacy-1');
  });

  it('原文只暴露没有凭据的 HTTP(S) 链接', () => {
    expect(normalizeRecord({ ...base, url: 'https://example.com/article' })?.url).toBe('https://example.com/article');
    for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'https://user:pass@example.com', 'invalid']) {
      expect(normalizeRecord({ ...base, url })?.url).toBeUndefined();
    }
  });

  it('文章标题原样透传，合法图鉴 ID 投影为同租户鉴权图片路径', () => {
    const memeId = 'aaaaaaaa-0000-0000-0000-000000000001';
    expect(normalizeRecord({ ...base, title: '独立短标题', memeId })).toMatchObject({
      title: '独立短标题', memeImageUrl: `/api/meme/${memeId}/image.png`,
    });
    expect(normalizeRecord({ ...base, memeId: '../other-tenant' })?.memeImageUrl).toBeUndefined();
  });
});
