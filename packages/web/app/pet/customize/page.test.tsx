// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetGenTaskView } from '@cyber-stray/shared/petgen';
import CustomizePage from './page';

const usePetGenMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/usePetGen', () => ({ usePetGen: usePetGenMock }));
vi.mock('@/components/strayboy/PetAppearancePreview', () => ({ PetAppearancePreview: () => null }));
vi.mock('@/components/strayboy/BootFrame', () => ({ BootFrame: () => null }));

const failedTask: PetGenTaskView = {
  id: 'task-1', status: 'failed', specText: '一只黑猫', stylePreset: 'pixel',
  conceptUrl: '/api/petgen/tasks/task-1/concept.png', error: '视觉质检连续异常',
  canRetryQc: true, qcResult: null, conceptAttempts: 1,
  createdAt: 1, updatedAt: 2, completedAt: null, assetBase: null,
};

let root: Root;
let container: HTMLDivElement;
const retryQc = vi.fn(async () => true);
const restart = vi.fn(async () => true);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  retryQc.mockClear();
  restart.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(task: PetGenTaskView) {
  usePetGenMock.mockReturnValue({ task, quota: null, loading: false, error: null,
    submit: vi.fn(), confirm: vi.fn(), restart, retryQc });
  await act(async () => root.render(<CustomizePage />));
}

describe('改造屋失败任务质检重试', () => {
  it('仅 CP 字段允许时显示重试质检，点击只调用质检端点动作', async () => {
    await render(failedTask);
    const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '重试质检');
    expect(retry).toBeDefined();
    expect(container.textContent).toContain('可直接复检已有素材');
    expect(container.textContent).toContain('生成概念图');
    await act(async () => retry?.click());
    expect(retryQc).toHaveBeenCalledExactlyOnceWith('task-1');
    expect(restart).not.toHaveBeenCalled();
  });

  it('即使错误文案提到质检，CP 不允许时也不显示重试按钮', async () => {
    await render({ ...failedTask, canRetryQc: false });
    expect(container.textContent).toContain('视觉质检连续异常');
    expect(container.textContent).not.toContain('重试质检');
    expect(container.textContent).toContain('调整下面的描述重新提交');
  });
});
