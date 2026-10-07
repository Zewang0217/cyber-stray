// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PetGenTaskView } from '@cyber-stray/shared/petgen';
import { PetArrivalPanel } from './PetArrivalPanel';

const hook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/usePetGen', () => ({ usePetGen: hook }));
const base: PetGenTaskView = {
  id: 'arrival', status: 'qc', specText: '小黑猫', stylePreset: 'pixel', conceptUrl: null,
  error: null, canRetryQc: false, qcResult: null, conceptAttempts: 1,
  createdAt: 1, updatedAt: 2, completedAt: null, assetBase: null,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(task: PetGenTaskView | null, error: string | null = null) {
  hook.mockReturnValue({ task, error, refresh: vi.fn() });
  await act(async () => root.render(<PetArrivalPanel refreshSignal={0} />));
}
it('已有完成素材不重复庆祝，正在生成的任务完成后显示一次见面反馈', async () => {
  await render({ ...base, status: 'done' }); expect(container.textContent).toBe('');
  await render(base); expect(container.textContent).toContain('照一次镜子');
  await render({ ...base, status: 'done' }); expect(container.textContent).toContain('准备好了');
  await act(async () => container.querySelector('button')!.click()); expect(container.textContent).toBe('');
  await render({ ...base, status: 'done' }); expect(container.textContent).toBe('');
});
it('进度读取失败不会被隐藏为无任务，生成失败有明确原因和恢复入口', async () => {
  await render(null, '会话已过期'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('会话已过期');
  await render({ ...base, status: 'failed', error: '图像服务超时', canRetryQc: true });
  expect(container.textContent).toContain('图像服务超时');
  expect(container.querySelector('a')?.textContent).toContain('查看原因与重试方式');
});
