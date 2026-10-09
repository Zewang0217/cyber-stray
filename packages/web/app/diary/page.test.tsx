// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiaryPage from './page';

vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: (key: string) => (key === 'demo' ? '1' : null) }) }));
vi.mock('@/components/strayboy/BootFrame', () => ({ BootFrame: () => null }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('日记本弹窗正文 markdown 渲染', () => {
  it('列表与加粗渲染为对应元素，首行 # 标题不重复出现', async () => {
    await act(async () => root.render(<DiaryPage />));
    // 列表卡片打开弹窗（demo 第一篇含 markdown 列表 + 加粗）
    const card = Array.from(container.querySelectorAll<HTMLButtonElement>('article button'))[0]!;
    await act(async () => card.click());

    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('ul li')?.textContent).toContain('面馆的灯箱');
    expect(dialog.querySelector('strong')?.textContent).toBe('多了三块');
    // 正文首行 `# 标题` 已剥除：弹窗内不出现一级标题
    expect(dialog.querySelector('h1')).toBeNull();
    expect(dialog.textContent).not.toContain('# 关于城南的霓虹灯');
  });
});
