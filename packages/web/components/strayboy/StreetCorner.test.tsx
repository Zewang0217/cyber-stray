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
    if (url === '/api/petgen/tasks') return Response.json({ success: true, data: [] });
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
  it('拍拍播放经典 joy，低精力播放 sleep，睡眠期拍拍不打断；待机画面也用自定义 walk', async () => {
    window.localStorage.setItem('sb_coat', 'black');
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
    expect(petImage()?.src).toContain('/sleep.png?');
    expect(container.textContent).toContain('没醒');
    await act(async () => vi.advanceTimersByTime(315_000));
    const attract = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'STREET MODE')?.parentElement;
    expect(attract?.querySelector('img')?.src).toContain('/api/pet-assets/walk.png?');
    expect(attract?.innerHTML).not.toContain('/pet/strayboy/');
    expect(petImage()?.style.filter).toBe('');
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
