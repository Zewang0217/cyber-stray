// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailCard } from './MailCard';

let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('明信片墙卡片', () => {
  it('完整展示长标题与正文摘要，并保留打开全文操作', async () => {
    const card = {
      title: '这是一条超过十八个汉字但值得完整阅读的真实独立标题',
      summary: '纯文本摘要',
      message: '**重点正文**\n- 列表项目\n\n裸链接 https://example.com/guide ![远程图](https://example.com/track.png)',
      timestamp: '2026-10-04T12:00:00Z',
      messageId: 'content-217',
      url: 'https://example.com/story',
    };
    const onOpen = vi.fn();
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => {
      root.render(<MailCard card={card} seenMs={0} onFeedback={() => {}}
        onPin={() => {}} pending={false} onOpen={onOpen} />);
    });
    expect(container.querySelector('h3')?.textContent).toBe(card.title);
    expect(container.textContent).toContain('2026-10-04');
    expect(container.querySelector('strong')?.textContent).toBe('重点正文');
    expect(container.querySelector('li')?.textContent).toBe('列表项目');
    expect(container.querySelector('a[href="https://example.com/guide"]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).toContain('打开全文');
    expect(container.textContent).not.toContain('纯文本摘要');
    expect(container.querySelector('a[href="https://example.com/story"]')?.textContent).toContain('阅读原文');
    const open = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('打开全文'));
    await act(async () => { open?.click(); });
    expect(onOpen).toHaveBeenCalledWith(card);
  });

  it('只展示共享契约给出的表情包图片路径，加载失败时显式提示', async () => {
    const card = {
      title: '猫画了一张图', summary: '纯文本摘要', message: '正文没有远程图片',
      timestamp: '2026-10-04T12:00:00Z',
      memeImageUrl: '/api/meme/123e4567-e89b-12d3-a456-426614174000/image.png',
    };
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => {
      root.render(<MailCard card={card} seenMs={0} onFeedback={() => {}}
        onPin={() => {}} pending={false} onOpen={() => {}} />);
    });
    const image = container.querySelector('img[alt="猫寄回的表情包"]');
    expect(new URL(image?.getAttribute('src') ?? '').pathname).toBe(card.memeImageUrl);
    await act(async () => { image?.dispatchEvent(new Event('error', { bubbles: true })); });
    expect(container.textContent).toContain('表情包暂时无法加载');
  });
});
