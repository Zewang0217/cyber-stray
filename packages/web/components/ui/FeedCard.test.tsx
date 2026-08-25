// @vitest-environment jsdom
/**
 * FeedCard 展示重构测试（#121）
 *
 * 契约：
 * - Markdown 渲染：**粗体** → <strong>（无字面 **）；列表 → <ul><li>
 * - 去三段重复：不再渲染 title 行与 summary 行（正文为唯一内容主体）
 * - 旧记录（无独立 title/summary/type）仅渲染 message 仍正常
 * - 有 url 时渲染原文链接；type 渲染类型标签
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PushContent } from '@/lib/types';
import { FeedCard } from './FeedCard';

function render(item: PushContent) {
  const container = document.createElement('div');
  const root = createRoot(container);
  root.render(<FeedCard item={item} />);
  return { container, root };
}

beforeEach(() => {
  // useFeedback 内部会 fetch 反馈接口；仅渲染不触发，mock 兜底防意外请求
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ success: true }), ok: true }) as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FeedCard 展示重构（#121）', () => {
  it('Markdown 粗体渲染为 strong，无字面 **', async () => {
    const item: PushContent = {
      message: '今天挖到**大瓜**：模型可以匿名',
      title: '今天挖到大瓜：模型可以匿名',
      summary: '今天挖到大瓜',
      timestamp: '2026-08-25T00:00:00Z',
    };
    const { container, root } = render(item);
    await act(async () => {});
    expect(container.textContent).toContain('大瓜');
    expect(container.textContent).not.toContain('**');
    expect(container.querySelector('strong')?.textContent).toBe('大瓜');
    root.unmount();
  });

  it('Markdown 列表渲染为 ul/li', async () => {
    const item: PushContent = {
      message: '要点：\n- 第一\n- 第二',
      title: '要点',
      summary: '要点',
      timestamp: '2026-08-25T00:00:00Z',
    };
    const { container, root } = render(item);
    await act(async () => {});
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    root.unmount();
  });

  it('去三段重复：不渲染 title 行与 summary 行', async () => {
    const item: PushContent = {
      message: '正文内容',
      title: '标题内容',
      summary: '摘要内容',
      timestamp: '2026-08-25T00:00:00Z',
    };
    const { container, root } = render(item);
    await act(async () => {});
    expect(container.textContent).toContain('正文内容');
    expect(container.textContent).not.toContain('标题内容');
    expect(container.textContent).not.toContain('摘要内容');
    root.unmount();
  });

  it('旧记录（无独立 title/summary）仅 message 渲染正常', async () => {
    const item: PushContent = {
      message: '早期只有正文的记录',
      // API 归一化补齐的 title/summary 为正文截断；卡片不再渲染它们
      title: '早期只有正文的记录',
      summary: '早期只有正文的记录',
      timestamp: '2026-08-01T00:00:00Z',
    };
    const { container, root } = render(item);
    await act(async () => {});
    expect(container.textContent).toContain('早期只有正文的记录');
    root.unmount();
  });

  it('type 标签 + url 原文链接渲染', async () => {
    const item: PushContent = {
      message: '看这个链接',
      title: '看这个链接',
      summary: '看这个链接',
      type: 'share',
      url: 'https://example.com/a',
      timestamp: '2026-08-25T00:00:00Z',
    };
    const { container, root } = render(item);
    await act(async () => {});
    expect(container.textContent).toContain('分享');
    const link = container.querySelector('a[aria-label="打开原文"]') as HTMLAnchorElement | null;
    expect(link?.href).toBe('https://example.com/a');
    root.unmount();
  });
});
