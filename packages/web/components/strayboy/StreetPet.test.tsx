// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PET_SHEET_ANIMS, PET_STATES, PET_STATE_IDS } from '@cyber-stray/shared/pet';
import { parsePetAppearance } from '@cyber-stray/shared/pet-appearance';
import { parseSpriteContract } from '@cyber-stray/shared/sprite';
import builtinFrames from '../../public/pet/strayboy/frames.json';
import { usePetManifest } from '../../hooks/usePetManifest';
import { StreetPet } from './StreetPet';

const contract = parseSpriteContract(builtinFrames);
const classic = (generatedAt = '2026-10-05T00:00:00.000Z') => ({
  version: 1, generatedAt,
  states: Object.fromEntries(PET_STATE_IDS.map((state) => [state, { ...PET_STATES[state], frames: 1 }])),
});
function sheet() {
  let from = 0;
  return {
    ...classic(), version: 2, states: {},
    sprite: {
      image: 'sprite.png', frame: { w: 64, h: 64, groundRow: 63 }, displayScale: 2,
      animations: Object.fromEntries(PET_SHEET_ANIMS.map(({ state, frames, duration }) => {
        const animation = { from, frames, duration, loop: true };
        from += frames;
        return [state, animation];
      })),
    },
  };
}
function LivePet({ refreshToken = 0 }: { refreshToken?: number }) {
  const assets = usePetManifest({ refreshToken });
  return <StreetPet {...assets} contract={contract} anim="idle" coat="black" />;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('街角素材播放器', () => {
  it.each(PET_STATE_IDS)('经典 %s 使用对应自定义 PNG 与状态时长，不套内置毛色', async (anim) => {
    await act(async () => root.render(<StreetPet contract={contract} appearance={parsePetAppearance(classic())} loaded error={null} anim={anim} coat="black" />));
    const image = container.querySelector('img')!;
    const url = new URL(image.src);
    expect(url.pathname).toBe(`/api/pet-assets/${anim}.png`);
    expect(url.searchParams.get('v')).toBe(classic().generatedAt);
    expect(image.alt).toBe(PET_STATES[anim].label);
    expect(image.dataset.anim).toBe(anim);
    expect(image.style.animationDuration).toBe(`${PET_STATES[anim].dur}s`);
    expect(image.style.filter).toBe('');
    expect(container.innerHTML).not.toContain('/pet/strayboy/');
  });

  it('拍拍映射 joy，睡眠切到 sleep，恢复时回到 idle', async () => {
    for (const [anim, expected] of [['pat', 'joy'], ['sleep', 'sleep'], ['idle', 'idle']]) {
      await act(async () => root.render(<StreetPet contract={contract} appearance={parsePetAppearance(classic())} loaded error={null} anim={anim} />));
      expect(container.querySelector('img')?.getAttribute('src')).toContain(`/${expected}.png?`);
    }
  });

  it('sheet 延续 CSS 帧播放、缩放和拍拍映射，不套自定义毛色；坏图明确报错', async () => {
    await act(async () => root.render(<StreetPet contract={contract} appearance={parsePetAppearance(sheet())} loaded error={null} anim="pat" coat="calico" />));
    const frame = container.querySelector<HTMLSpanElement>('span.pixelated')!;
    expect(frame.style.backgroundImage).toContain('/api/pet-assets/sprite.png?v=');
    expect(frame.style.width).toBe('128px');
    expect(frame.style.filter).toBe('none');
    expect(container.querySelector('[data-anim]')?.getAttribute('data-anim')).toBe('joy');
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('sprite.png');
    expect(container.querySelector('span.pixelated')).toBeNull();
  });

  it('经典 PNG 失败持续可见；新一轮生成的资源版本才清错重试', async () => {
    await act(async () => root.render(<StreetPet contract={contract} appearance={parsePetAppearance(classic())} loaded error={null} anim="idle" />));
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('idle.png');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('请先刷新页面重试');
    expect(container.innerHTML).not.toContain('/pet/strayboy/');
    await act(async () => root.render(<StreetPet contract={contract} appearance={parsePetAppearance(classic())} loaded error={null} anim="sleep" />));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => root.render(<StreetPet contract={contract} appearance={parsePetAppearance(classic('2026-10-05T00:01:00.000Z'))} loaded error={null} anim="idle" />));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('00%3A01%3A00');
  });

  it('只在 manifest 404 时使用内置素材，保留毛色', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => root.render(<LivePet />));
    const frame = container.querySelector<HTMLSpanElement>('span.pixelated')!;
    expect(frame.style.backgroundImage).toContain('/pet/strayboy/');
    expect(frame.style.filter).toContain('brightness');
  });

  it('加载期间不闪回内置猫', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    await act(async () => root.render(<LivePet />));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('加载');
    expect(container.innerHTML).not.toContain('/pet/strayboy/');
  });

  it.each(['http', 'malformed'] as const)('manifest %s 错误公开显示且不播放内置猫', async (failure) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => failure === 'http'
      ? new Response(null, { status: 500 })
      : Response.json({ ...classic(), states: {} })));
    await act(async () => root.render(<LivePet />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(failure === 'http' ? 'HTTP 500' : 'states.idle');
    expect(container.innerHTML).not.toContain('/pet/strayboy/');
  });

  it('素材就绪信号重取 manifest：sheet → 经典，且相同路径的新生成绕过旧缓存', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(sheet()))
      .mockResolvedValueOnce(Response.json(classic('2026-10-05T00:01:00.000Z')))
      .mockResolvedValueOnce(Response.json(classic('2026-10-05T00:02:00.000Z')));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<LivePet />));
    expect(container.querySelector('span.pixelated')?.getAttribute('style')).toContain('sprite.png');
    await act(async () => root.render(<LivePet refreshToken={1} />));
    expect(container.querySelector('span.pixelated')).toBeNull();
    const first = container.querySelector('img')!.src;
    expect(first).toContain('idle.png');
    await act(async () => root.render(<LivePet refreshToken={2} />));
    expect(container.querySelector('img')!.src).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pet/manifest');
  });

  it.each(['http', 'malformed'] as const)('已显示素材刷新遇到 %s 错误，后续就绪信号成功后恢复播放', async (failure) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(classic()))
      .mockResolvedValueOnce(failure === 'http'
        ? new Response(null, { status: 503 })
        : Response.json({ ...classic(), states: {} }))
      .mockResolvedValueOnce(Response.json(classic('2026-10-05T00:02:00.000Z')));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<LivePet />));
    expect(container.querySelector('img')?.src).toContain('/idle.png?');
    await act(async () => root.render(<LivePet refreshToken={1} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(failure === 'http' ? 'HTTP 503' : 'states.idle');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('/pet/strayboy/');
    await act(async () => root.render(<LivePet refreshToken={2} />));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const url = new URL(container.querySelector('img')!.src);
    expect(url.pathname).toBe('/api/pet-assets/idle.png');
    expect(url.searchParams.get('v')).toBe('2026-10-05T00:02:00.000Z');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
