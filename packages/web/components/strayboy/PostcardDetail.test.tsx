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
    const like = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('赞'));
    expect(like?.disabled).toBe(false);
    await act(async () => { like?.click(); });
    expect(onFeedback).toHaveBeenCalledWith('like', card);
  });
});
