// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostcardDetail } from './PostcardDetail';

let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('明信片阅读与反馈', () => {
  it('可从收到的明信片打开原文，并用内容标识反馈', async () => {
    const card = {
      title: '猫叼回来的教程', message: '一套像素动画教程', summary: '教程',
      timestamp: '2026-10-04T12:00:00Z', url: 'https://example.com/pixel-cat',
      messageId: 'content-217',
      memeImageUrl: '/api/meme/123e4567-e89b-12d3-a456-426614174000/image.png',
    };
    const onFeedback = vi.fn();
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => {
      root.render(<PostcardDetail card={card} adoptedAt={0} onFeedback={onFeedback}
        onPin={() => {}} pending={false} onClose={() => {}} />);
    });
    const link = container.querySelector('a');
    expect(link?.textContent).toContain('阅读原文');
    expect(link?.href).toBe(card.url);
    expect(link?.rel).toContain('noopener');
    expect(new URL(container.querySelector('img[alt="猫寄回的表情包"]')?.getAttribute('src') ?? '').pathname).toBe(card.memeImageUrl);
    const like = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('赞'));
    expect(like?.disabled).toBe(false);
    await act(async () => { like?.click(); });
    expect(onFeedback).toHaveBeenCalledWith('like', card);
  });

  it('渲染安全 Markdown 链接并拒绝脚本链接、原始 HTML 与远程图片', async () => {
    const card = {
      title: '完整标题',
      summary: 'Markdown 安全验收',
      message: '**重点** [阅读资料](https://example.com/guide) 裸链接 https://example.com/bare [危险](javascript:alert(1)) ![追踪像素](https://example.com/track.png) <script>alert(1)</script>',
      timestamp: '2026-10-04T12:00:00Z',
      url: 'javascript:alert(1)',
    };
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => {
      root.render(<PostcardDetail card={card} adoptedAt={0} onFeedback={() => {}}
        onPin={() => {}} pending={false} onClose={() => {}} />);
    });
    expect(container.querySelector('strong')?.textContent).toBe('重点');
    expect(container.querySelector('a[href="https://example.com/guide"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://example.com/bare"]')).not.toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.rel).toContain('noopener');
    expect(container.textContent).not.toContain('阅读原文');
  });
});
