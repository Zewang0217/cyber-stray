// @vitest-environment jsdom
/**
 * AdoptionFlow 候选请求回归测试（#114 切片 3 review 修复）
 *
 * 契约：
 * - 起名步：组件挂载时请求一次候选；输入名字每个字符**不再**触发 LLM
 *   请求（旧 bug：catchphrase 候选依赖 name 状态,每敲一字重拉 → 烧钱 + 乱序）
 *
 * 注：口头禅步的端到端导航（4 步 + 带 name/personality 的候选请求）已用
 * 真实浏览器验证（adopt 201 + postData 断言）；jsdom + AnimatePresence
 * 的步骤切换在此环境不可靠，故只守打字不重载这一核心契约。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AdoptionFlow } from './AdoptionFlow';

/** jsdom 缺 rAF/matchMedia：framer-motion 依赖两者，测试桩 */
function stubBrowserAPIs(): void {
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 16);
  (globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) =>
    clearTimeout(id);
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

describe('AdoptionFlow 候选请求（review 修复）', () => {
  let container: HTMLElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubBrowserAPIs();
    const reactActEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    reactActEnv.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { candidates: ['小溜', '煤球', '年糕'], source: 'llm' },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('起名步挂载请求 1 次；输入名字每字符不新增请求', async () => {
    act(() => {
      root.render(<AdoptionFlow adopting={false} onAdopt={() => Promise.resolve(null)} />);
    });
    // 挂载 → 起名步候选请求
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]![0] as string).endsWith('/api/pets/adoption-candidates')).toBe(true);
    fetchMock.mockClear();

    await act(async () => {
      const input = container.querySelector('input')!;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      for (const ch of '豆芽菜') {
        setter.call(input, ch);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    // 旧 bug：每敲一个字符触发一次 LLM 候选请求（name 进 catchphrase 依赖）
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
