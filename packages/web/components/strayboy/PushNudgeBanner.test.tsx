// @vitest-environment jsdom
/**
 * PushNudgeBanner 状态机测试（#275 拒绝路径）
 *
 * 契约：
 * - off/error：后果文案（「它找不到你」）+ 开启/重试按钮（点击调 onEnable）
 * - denied：浏览器已拒 → 指引去站点设置补开，无按钮（再点只会再被拒）
 * - on：已订阅不渲染
 * - unsupported 非 iOS：设备不支持不渲染；iOS 未上主屏 → 主屏安装提示
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PushNudgeBanner } from './PushNudgeBanner';
import type { PushState } from '@/hooks/useWebPush';

function renderBanner(state: PushState, onEnable: () => void = () => {}) {
  const container = document.createElement('div');
  const root = createRoot(container);
  root.render(<PushNudgeBanner state={state} error={null} onEnable={onEnable} />);
  return { container, root };
}

function textOf(container: HTMLElement): string {
  return container.textContent ?? '';
}

beforeEach(() => {
  // jsdom 无 matchMedia；standalone 判定默认 false（未安装）
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
  }));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PushNudgeBanner（#275）', () => {
  it('off：显示后果文案 + 开启按钮，点击调 onEnable', async () => {
    const onEnable = vi.fn();
    const { container, root } = renderBanner('off', onEnable);
    await act(async () => {});
    expect(textOf(container)).toContain('它找不到你');

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEnable).toHaveBeenCalledOnce();
    root.unmount();
  });

  it('denied：指引去浏览器设置补开，不再放按钮', async () => {
    const onEnable = vi.fn();
    const { container, root } = renderBanner('denied', onEnable);
    await act(async () => {});
    expect(textOf(container)).toContain('补开');
    expect(container.querySelector('button')).toBeNull();
    root.unmount();
  });

  it('on：已订阅不渲染', async () => {
    const { container, root } = renderBanner('on');
    await act(async () => {});
    expect(textOf(container)).toBe('');
    root.unmount();
  });

  it('unsupported 非 iOS：设备不支持，不渲染', async () => {
    const { container, root } = renderBanner('unsupported');
    await act(async () => {});
    expect(textOf(container)).toBe('');
    root.unmount();
  });

  it('unsupported iOS 未上主屏：给主屏安装提示', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    const { container, root } = renderBanner('unsupported');
    await act(async () => {});
    expect(textOf(container)).toContain('添加到主屏幕');
    root.unmount();
  });
});
