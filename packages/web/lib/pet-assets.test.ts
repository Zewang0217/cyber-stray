/**
 * pet-assets 消费 lib 测试（#95 IP 消费侧）
 *
 * 契约：
 * - proceduralMotionFor：idle 呼吸(scale) / walk 位移(x) / celebrate 弹跳(y)，
 *   无限循环，时长取自素材 dur；未知状态抛错（禁兜底）
 * - loadPetManifest：200 → 解析清单；404/401/非 2xx → null（回退内置）；
 *   网络失败 → null；会话内缓存（不重复请求）；resetPetManifest 清除
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PET_STATES } from '@cyber-stray/shared/pet';
import type { PetAssetManifest } from '@cyber-stray/shared/pet';
import { loadPetManifest, proceduralMotionFor, resetPetManifest } from './pet-assets';

const MANIFEST: PetAssetManifest = {
  version: 1,
  generatedAt: '2026-08-20T00:00:00.000Z',
  spec: { specText: '戴红围巾的橘猫', stylePreset: 'chibi-kawaii' },
  concept: 'concept.png',
  states: Object.fromEntries(
    Object.entries(PET_STATES).map(([k, v]) => [k, { ...v, frames: 1 }]),
  ) as PetAssetManifest['states'],
};

describe('proceduralMotionFor（程序微动画参数）', () => {
  it('idle → 呼吸 scale 无限循环，时长取素材 dur', () => {
    const m = proceduralMotionFor('idle', 1.6);
    expect(m.animate.scale).toEqual([1, 1.05, 1]);
    expect(m.transition).toMatchObject({ duration: 1.6, repeat: Infinity });
  });

  it('walk → 位移 x', () => {
    expect(proceduralMotionFor('walk', 0.8).animate.x).toEqual([0, 8, 0]);
  });

  it('celebrate → 弹跳 y', () => {
    expect(proceduralMotionFor('celebrate', 0.65).animate.y).toEqual([0, -10, 0]);
  });

  it('每状态都有对应 keyframes（帧驱动内置状态的播放器微动画全覆盖）', () => {
    for (const state of Object.keys(PET_STATES) as Array<keyof typeof PET_STATES>) {
      expect(proceduralMotionFor(state, 1).animate).toBeDefined();
    }
  });

  it('未知状态 → 抛错（禁兜底）', () => {
    expect(() => proceduralMotionFor('unknown' as never, 1)).toThrow(/未知宠物状态/);
  });
});

describe('loadPetManifest（按租户加载 + 回退）', () => {
  beforeEach(() => {
    resetPetManifest();
  });

  afterEach(() => {
    resetPetManifest();
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown = null): ReturnType<typeof vi.fn> {
    const fn = vi.fn().mockResolvedValue(
      new Response(body === null ? null : JSON.stringify(body), { status }),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('200 → 解析返回清单（含状态表，frames:1）', async () => {
    stubFetch(200, MANIFEST);
    const manifest = await loadPetManifest();
    expect(manifest?.version).toBe(1);
    expect(manifest?.states.idle.frames).toBe(1);
    expect(manifest?.states.idle.label).toBe('待机呼吸');
  });

  it('404（无自定义）/ 401（未登录）→ null，回退内置', async () => {
    stubFetch(404);
    expect(await loadPetManifest()).toBeNull();
    resetPetManifest();
    stubFetch(401);
    expect(await loadPetManifest()).toBeNull();
  });

  it('非 2xx → null', async () => {
    stubFetch(500);
    expect(await loadPetManifest()).toBeNull();
  });

  it('网络失败 → null（消费侧 graceful degradation，不阻断页面）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await loadPetManifest()).toBeNull();
  });

  it('会话内缓存：只请求一次；resetPetManifest 后重新请求', async () => {
    const fetchMock = stubFetch(200, MANIFEST);
    await loadPetManifest();
    await loadPetManifest();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetPetManifest();
    await loadPetManifest();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('请求路径指向 /api/pet/manifest', async () => {
    const fetchMock = stubFetch(200, MANIFEST);
    await loadPetManifest();
    expect(fetchMock).toHaveBeenCalledWith('/api/pet/manifest');
  });
});
