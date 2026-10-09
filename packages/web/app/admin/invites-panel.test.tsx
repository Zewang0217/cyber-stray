// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvitesPanel from './invites-panel';

const INVITE_LINK = 'http://203.0.113.1/?invite=0123456789abcdef0123456789abcdef';
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(
    JSON.stringify({ success: true, data: init?.method === 'POST' ? { link: INVITE_LINK } : [] }),
  )));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label);
  if (!match) throw new Error(`缺少按钮：${label}`);
  return match;
}

async function generateInvite() {
  await act(async () => root.render(<InvitesPanel />));
  await act(async () => button('生成邀请链接').click());
}

describe('邀请链接复制', () => {
  it('HTTP 不支持剪贴板时提示手动复制，并能选中完整链接', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    await generateInvite();
    expect(container.textContent).toContain('当前环境不支持自动复制');
    const link = container.querySelector<HTMLInputElement>('input[aria-label="邀请链接"]');
    expect(link?.readOnly).toBe(true);
    expect(link?.value).toBe(INVITE_LINK);
    await act(async () => button('选中链接').click());
    expect(link?.selectionStart).toBe(0);
    expect(link?.selectionEnd).toBe(INVITE_LINK.length);
    expect(container.textContent).not.toContain('已复制');
  });

  it('只有剪贴板完成写入才显示已复制', async () => {
    let finishCopy!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { finishCopy = resolve; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await generateInvite();
    await act(async () => button('复制链接').click());
    expect(writeText).toHaveBeenCalledWith(INVITE_LINK);
    expect(container.textContent).not.toContain('已复制');
    await act(async () => finishCopy());
    expect(container.textContent).toContain('已复制');
  });

  it('复制被拒绝时明确提示手动复制，并保留完整链接', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await generateInvite();
    await act(async () => button('复制链接').click());
    expect(container.textContent).toContain('复制失败，请选中链接手动复制。');
    expect(container.textContent).not.toContain('已复制');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="邀请链接"]')?.value).toBe(INVITE_LINK);
  });
});

describe('邀请容量管理', () => {
  it('已用满旧链接仍能追加人数，吊销链接不显示追加按钮', async () => {
    const row = { id: 'old-link', label: '群推广', createdBy: 'admin', createdAt: 1, revokedAt: null, consumedAt: 2, consumedTenantId: 'user-a', maxUses: 1, usedCount: 1 };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') row.maxUses += 20;
      return new Response(JSON.stringify({ success: true, data: init?.method === 'POST' ? row : [row, { ...row, id: 'revoked', revokedAt: 3 }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<InvitesPanel />));
    expect(container.textContent).toContain('已用满');
    expect(container.textContent).toContain('已吊销');
    expect(container.querySelectorAll('form')).toHaveLength(1);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="增加人数 群推广"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, '20'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/invites/old-link/capacity', expect.objectContaining({ method: 'POST', body: JSON.stringify({ additionalUses: 20 }) }));
    expect(container.textContent).toContain('1 / 21 / 20');
  });
});
