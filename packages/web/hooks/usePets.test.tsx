// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePets } from './usePets';

let root: Root;
let value: ReturnType<typeof usePets>;

async function renderPets() {
  function Probe() { value = usePets(); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe />); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('宠物列表加载', () => {
  it('首次请求失败可区分于尚未领养，重试成功后清除加载错误', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('暂时无法连接'))
      .mockResolvedValueOnce(Response.json({ success: true, data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await renderPets();
    expect(value.isLoaded).toBe(true);
    expect(value.loadError).toBe('暂时无法连接');
    await act(async () => { await value.refresh(); });
    expect(value.loadError).toBeNull();
    expect(value.pets).toEqual([]);
  });
});
