// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdoptionRitual } from './AdoptionRitual';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { candidates: ['小溜', '煤球', '夜巡'] } })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text));
  expect(button).toBeDefined(); await act(async () => button!.click());
}

it('照片上传未完成不能领养；完成后保留选择并进入非阻塞的见面画面', async () => {
  const adopt = vi.fn(async () => ({ id: 'pet-1' }));
  const onAdopted = vi.fn();
  await act(async () => root.render(<AdoptionRitual adopt={adopt} adopting={false} adoptError={null} onAdopted={onAdopted} />));
  await click('NEW GAME'); await click('小溜'); await click('下一步');
  expect(document.activeElement?.textContent).toContain('选性格');
  await click('好奇'); await click('下一步'); await click('下一步'); await click('科技');
  let finishUpload!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finishUpload = resolve; }));
  const revoke = vi.fn();
  class PreviewURL extends URL {
    static createObjectURL = vi.fn(() => 'blob:reference');
    static revokeObjectURL = revoke;
  }
  vi.stubGlobal('URL', PreviewURL);
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, 'files', { value: [new File(['png'], 'cat.png', { type: 'image/png' })] });
  await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
  const pending = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('等待照片上传'))!;
  expect(pending.disabled).toBe(true); await act(async () => pending.click()); expect(adopt).not.toHaveBeenCalled();
  await act(async () => finishUpload(Response.json({ success: true })));
  await click('开始游荡（领养）');
  expect(adopt).toHaveBeenCalledExactlyOnceWith({ name: '小溜', personality: 'curious', catchphrases: undefined, interests: ['科技'] });
  expect(container.textContent).toContain('不必等专属形象画完');
  expect(onAdopted).not.toHaveBeenCalled();
  await click('开始游荡'); expect(onAdopted).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(revoke).toHaveBeenCalledWith('blob:reference');
});
