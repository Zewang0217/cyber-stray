// @vitest-environment jsdom
/**
 * PetSprite 测试（#93 睡眠期轻互动 + #95 自定义素材/程序微动画）
 *
 * 契约：
 * - 睡眠期拍拍 → 哼唧回应（气泡出现），**不改展示状态**（仍 sleep 素材，
 *   不醒、不打断梦境）；哼唧超时后自动消失、仍睡眠
 * - 清醒拍拍 → 开心（joy 素材）
 * - 睡眠拍拍不触发任何真实状态变更（组件无状态写路径——纯展示层）
 * - #95：有自定义 manifest（frames:1）→ 素材走 /api/pet-assets/<file>，
 *   且包一层程序微动画容器（.pet-player-procedural）
 * - #95：无自定义 manifest → 完全回退内置 /pet/<state>.png（帧驱动，无程序容器）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PET_STATES } from '@cyber-stray/shared/pet';
import type { PetAssetManifest } from '@cyber-stray/shared/pet';
import { PetSprite } from './PetSprite';

// #95：控制 usePetAssets 返回的 manifest（null = 回退内置；对象 = 自定义素材）
const assetState = vi.hoisted(() => ({ manifest: null as PetAssetManifest | null }));
vi.mock('@/lib/pet-assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pet-assets')>();
  return {
    ...actual, // 保留 proceduralMotionFor 真实实现
    usePetAssets: () => ({ manifest: assetState.manifest, loaded: true }),
  };
});

/** 构造自定义 manifest（frames:1 单帧，沿用 PET_STATES 的 dur/label） */
function customManifest(): PetAssetManifest {
  return {
    version: 1,
    generatedAt: '2026-08-20T00:00:00.000Z',
    spec: { specText: '戴红围巾的橘猫', stylePreset: 'chibi-kawaii' },
    concept: 'concept.png',
    states: Object.fromEntries(
      Object.entries(PET_STATES).map(([k, v]) => [k, { ...v, frames: 1 }]),
    ) as PetAssetManifest['states'],
  };
}

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

describe('PetSprite 睡眠期轻互动（#93）', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    stubBrowserAPIs();
    assetState.manifest = null; // 默认回退内置
    // React 19 act() 需显式声明测试环境（否则只告警不报错）——React 官方测试标志
    const reactActEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    reactActEnv.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderSprite(props: {
    state?: 'sleep';
    sleeping?: boolean;
    pattable?: boolean;
  }): Promise<HTMLButtonElement> {
    await act(async () => {
      root.render(<PetSprite size={100} pattable state={props.state} sleeping={props.sleeping} />);
    });
    const button = container.querySelector('button');
    if (!button) throw new Error('pattable 时应渲染 button');
    return button as HTMLButtonElement;
  }

  it('睡眠期拍拍 → 哼唧气泡出现，展示状态不变（仍 sleep 素材）', async () => {
    const button = await renderSprite({ state: 'sleep', sleeping: true });

    // 拍拍前：睡眠素材（内置回退）
    expect(button.style.backgroundImage).toContain('/pet/sleep.png');
    expect(container.textContent).not.toContain('哼唧');

    act(() => button.click());

    // 哼唧回应出现
    expect(container.textContent).toContain('哼唧');
    // 不醒：素材仍是 sleep（未被 joy 覆盖）
    expect(button.style.backgroundImage).toContain('/pet/sleep.png');
    expect(button.style.backgroundImage).not.toContain('/pet/joy.png');
  });

  it('哼唧超时后自动消失，仍睡眠', async () => {
    const button = await renderSprite({ state: 'sleep', sleeping: true });
    act(() => button.click());
    expect(container.textContent).toContain('哼唧');

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(container.textContent).not.toContain('哼唧');
    expect(button.style.backgroundImage).toContain('/pet/sleep.png');
  });

  it('清醒拍拍 → 开心（joy 素材），行为与改动前一致', async () => {
    const button = await renderSprite({ sleeping: false });
    expect(button.style.backgroundImage).toContain('/pet/idle.png');
    expect(container.textContent).not.toContain('哼唧');

    act(() => button.click());

    expect(container.textContent).not.toContain('哼唧');
    expect(button.style.backgroundImage).toContain('/pet/joy.png');
  });

  it('无自定义素材 → 完全回退内置（/pet/<state>.png，无程序微动画容器）', async () => {
    assetState.manifest = null;
    const button = await renderSprite({ sleeping: false });
    expect(button.style.backgroundImage).toContain('/pet/idle.png');
    expect(button.style.backgroundImage).not.toContain('/api/pet-assets');
    expect(container.querySelector('.pet-player-procedural')).toBeNull();
  });

  it('有自定义素材（frames:1）→ 素材走 /api/pet-assets/<file>，且启用程序微动画容器', async () => {
    assetState.manifest = customManifest();
    const button = await renderSprite({ sleeping: false });

    // 素材 URL 指向租户鉴权路径
    expect(button.style.backgroundImage).toContain('/api/pet-assets/idle.png');
    expect(button.style.backgroundImage).not.toContain('/pet/idle.png');

    // 单帧 → 程序微动画容器存在（外层 motion.div）
    const wrapper = container.querySelector('.pet-player-procedural');
    expect(wrapper).not.toBeNull();
  });

  it('自定义素材睡眠状态 → sleep 素材走租户路径', async () => {
    assetState.manifest = customManifest();
    const button = await renderSprite({ state: 'sleep', sleeping: true });
    expect(button.style.backgroundImage).toContain('/api/pet-assets/sleep.png');
  });
});
