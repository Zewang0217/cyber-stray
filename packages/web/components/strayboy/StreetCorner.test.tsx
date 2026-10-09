// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PET_STATE_IDS, PET_STATES } from '@cyber-stray/shared/pet';
import { parseSpriteContract } from '@cyber-stray/shared/sprite';
import { DEMO_PET, DEMO_STATE } from '../../lib/strayboy/demo';
import builtinFrames from '../../public/pet/strayboy/frames.json';
import { StreetCorner } from './StreetCorner';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

class Events {
  static latest: Events;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  constructor() { Events.latest = this; }
  close() {}
}

const contract = parseSpriteContract(builtinFrames);
const classic = () => ({
  version: 1, generatedAt: '2026-10-05T00:00:00.000Z',
  states: Object.fromEntries(PET_STATE_IDS.map((state) => [state, { ...PET_STATES[state], frames: 1 }])),
});
let container: HTMLDivElement;
let root: Root;
let manifest: ReturnType<typeof classic> | null;
let agentState = DEMO_STATE;
let fetchMock: ReturnType<typeof vi.fn>;
const petImage = () => container.querySelector<HTMLImageElement>('button[aria-label="拍拍年糕"] img');
async function event(type: string, at: number) {
  await act(async () => Events.latest.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type, at, tenantId: 'test' }) })));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00+08:00'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('EventSource', Events);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  window.localStorage.clear();
  manifest = classic();
  agentState = DEMO_STATE;
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/pets') return Response.json({ success: true, data: [DEMO_PET] });
    if (url === '/api/state') return Response.json({ success: true, data: agentState });
    if (url === '/api/pet/manifest') return manifest ? Response.json(manifest) : new Response(null, { status: 404 });
    throw new Error(`非预期请求 ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StreetCorner 自定义素材接线（真实 hooks / 状态机 / 播放器）', () => {
  it('首次进入不会在 15 秒后误入待机；超过 5 分钟无交互才进入', async () => {
    await act(async () => root.render(<StreetCorner contract={contract} />));
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(container.textContent).not.toContain('STREET MODE');
    await act(async () => vi.advanceTimersByTime(300_000));
    expect(container.textContent).toContain('STREET MODE');
  });

  it('夜晚清醒时显示夜街，白天预算休息时仍是日景，光照不改变真实宠物状态', async () => {
    vi.setSystemTime(new Date('2026-10-08T22:00:00'));
    await act(async () => root.render(<StreetCorner contract={contract} />));
    expect(container.querySelector('[aria-label="街角场景"]')?.getAttribute('data-light')).toBe('night');
    expect(petImage()?.src).toContain('/idle.png?');
    vi.setSystemTime(new Date('2026-10-09T12:00:00'));
    await act(async () => vi.advanceTimersByTime(30_000));
    await event('budget_exhausted', 100);
    expect(container.querySelector('[aria-label="街角场景"]')?.getAttribute('data-light')).toBe('day');
    expect(container.querySelectorAll('[data-scene-art]')).toHaveLength(1);
    expect(petImage()?.src).toContain('/sleep.png?');
  });
  it('拍拍播放经典 joy，低精力播放 sleep，预算休息仍可互动；待机画面也用自定义 walk', async () => {
    await act(async () => root.render(<StreetCorner contract={contract} />));
    expect(petImage()?.src).toContain('/api/pet-assets/idle.png?');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="拍拍年糕"]')!.click());
    expect(petImage()?.src).toContain('/joy.png?');
    await act(async () => vi.advanceTimersByTime(500));
    agentState = { ...DEMO_STATE, energy: 10 };
    await event('worker_succeeded', 1);
    expect(petImage()?.src).toContain('/sleep.png?');
    expect(container.textContent).toContain('zZ');
    await event('budget_exhausted', 2);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="拍拍年糕"]')!.click());
    expect(petImage()?.src).toContain('/joy.png?');
    await act(async () => vi.advanceTimersByTime(315_000));
    const attract = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'STREET MODE')?.parentElement;
    expect(attract?.querySelector('img')?.src).toContain('/api/pet-assets/walk.png?');
    expect(attract?.innerHTML).not.toContain('/pet/strayboy/');
  });

  it('白天预算休息仍可拍拍，作息睡眠不被叫醒', async () => {
    await act(async () => root.render(<StreetCorner contract={contract} />));
    await event('budget_exhausted', 20);
    expect(container.textContent).toContain('今天的探索已结束');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="拍拍年糕"]')!.click());
    expect(petImage()?.src).toContain('/joy.png?');
  });

  it('北京时间作息睡眠优先于预算休息，拍拍不叫醒', async () => {
    vi.setSystemTime(new Date('2026-10-08T22:00:00+08:00'));
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => url === '/api/pets'
      ? Response.json({ success: true, data: [{ ...DEMO_PET, sleepStart: 22, sleepEnd: 7, budgetPaused: true }] })
      : original(url));
    await act(async () => root.render(<StreetCorner contract={contract} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="拍拍年糕"]')!.click());
    expect(petImage()?.src).toContain('/sleep.png?');
    expect(container.textContent).toContain('没醒');
    expect(container.textContent).not.toContain('今天的探索已结束');
  });

  it('pet_assets_ready 将内置猫热切换成经典素材，随后普通事件不反复重取 manifest', async () => {
    manifest = null;
    await act(async () => root.render(<StreetCorner contract={contract} />));
    expect(petImage()).toBeNull();
    manifest = classic();
    await event('pet_assets_ready', 100);
    expect(petImage()?.src).toContain('/api/pet-assets/idle.png?');
    await event('worker_succeeded', 101);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/pet/manifest')).toHaveLength(2);
  });
});
