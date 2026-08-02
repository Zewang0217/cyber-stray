import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserContext } from './lifecycle.js';

const mockWarmUp = vi.fn<() => Promise<boolean>>();
const mockShutdown = vi.fn<() => Promise<void>>();

vi.mock('./executor.js', () => ({
  getBrowserExecutor: () => ({
    warmUp: mockWarmUp,
    shutdown: mockShutdown,
  }),
}));

const mockReadFile = vi.fn<(path: string, enc: string) => Promise<string>>();
const mockWriteFile = vi.fn<() => Promise<void>>();
const mockMkdir = vi.fn<() => Promise<void>>();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...(args as [string, string])),
  writeFile: (...args: unknown[]) => mockWriteFile(...(args as [])),
  mkdir: (...args: unknown[]) => mockMkdir(...(args as [])),
}));

vi.mock('node:crypto', () => ({
  randomBytes: () => ({ toString: () => 'b'.repeat(64) }),
}));

vi.mock('../../config.js', () => ({
  config: {
    browser: {
      enabled: true,
      warmUpOnStart: true,
      closeAfterWander: false,
      timeout: 30000,
      sessionName: 'cyber-stray',
      restore: true,
    },
  },
  getDataPath: (f: string) => `data/${f}`,
}));

vi.mock('../../logger.js', () => ({
  consola: {
    withTag: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  browserWarmUp,
  browserShutdown,
  buildBrowserPromptSection,
  updateBrowserContext,
  getBrowserContext,
  _resetBrowserContext,
} from './lifecycle.js';

describe('browser lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetBrowserContext();
    // 默认 key 文件不存在 → 走生成路径
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  describe('browserWarmUp', () => {
    it('成功时返回 BrowserContext（enabled: true, currentUrl: about:blank）', async () => {
      mockWarmUp.mockResolvedValue(true);

      const ctx = await browserWarmUp();

      expect(ctx).not.toBeNull();
      expect(ctx!.enabled).toBe(true);
      expect(ctx!.currentUrl).toBe('about:blank');
      expect(ctx!.currentPageTitle).toBeNull();
      expect(ctx!.openTabs).toEqual([]);
      expect(ctx!.recentPages).toEqual([]);
      expect(ctx!.sessionStartTime).toBeTruthy();
      expect(mockWarmUp).toHaveBeenCalledTimes(1);
    });

    it('预热失败时返回 null（降级为无浏览器模式）', async () => {
      mockWarmUp.mockResolvedValue(false);

      const ctx = await browserWarmUp();

      expect(ctx).toBeNull();
      expect(getBrowserContext()).toBeNull();
    });

    it('预热异常时返回 null（不抛错）', async () => {
      mockWarmUp.mockRejectedValue(new Error('spawn ENOENT'));

      const ctx = await browserWarmUp();

      expect(ctx).toBeNull();
      expect(getBrowserContext()).toBeNull();
    });

    it('预热成功后 getBrowserContext 返回同一对象', async () => {
      mockWarmUp.mockResolvedValue(true);

      const ctx = await browserWarmUp();
      expect(getBrowserContext()).toBe(ctx);
    });
  });

  describe('browserShutdown', () => {
    it('关闭后重置上下文', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();
      expect(getBrowserContext()).not.toBeNull();

      mockShutdown.mockResolvedValue(undefined);
      await browserShutdown();

      expect(getBrowserContext()).toBeNull();
      expect(mockShutdown).toHaveBeenCalledTimes(1);
    });

    it('shutdown 抛错时不传播（忽略错误）', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();

      mockShutdown.mockRejectedValue(new Error('close failed'));
      await expect(browserShutdown()).resolves.toBeUndefined();
    });

    it('无上下文时 shutdown 仍正常执行', async () => {
      mockShutdown.mockResolvedValue(undefined);
      await expect(browserShutdown()).resolves.toBeUndefined();
      expect(mockShutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildBrowserPromptSection', () => {
    it('null 上下文 → 空字符串', () => {
      expect(buildBrowserPromptSection(null)).toBe('');
    });

    it('enabled: false → 空字符串', () => {
      const ctx: BrowserContext = {
        enabled: false,
        currentUrl: 'https://example.com',
        currentPageTitle: 'Example',
        openTabs: [],
        recentPages: [],
        sessionStartTime: new Date().toISOString(),
      };
      expect(buildBrowserPromptSection(ctx)).toBe('');
    });

    it('包含当前 URL 和标题', () => {
      const ctx: BrowserContext = {
        enabled: true,
        currentUrl: 'https://example.com',
        currentPageTitle: 'Example Domain',
        openTabs: [],
        recentPages: [],
        sessionStartTime: new Date().toISOString(),
      };
      const section = buildBrowserPromptSection(ctx);
      expect(section).toContain('## 浏览器状态');
      expect(section).toContain('https://example.com');
      expect(section).toContain('Example Domain');
    });

    it('包含标签页信息', () => {
      const ctx: BrowserContext = {
        enabled: true,
        currentUrl: 'https://example.com',
        currentPageTitle: null,
        openTabs: [
          { tabId: 't1', title: 'Tab One', url: 'https://one.com', active: true },
          { tabId: 't2', title: '', url: 'https://two.com', active: false },
        ],
        recentPages: [],
        sessionStartTime: new Date().toISOString(),
      };
      const section = buildBrowserPromptSection(ctx);
      expect(section).toContain('t1: Tab One');
      expect(section).toContain('t2: https://two.com');
    });

    it('包含最近浏览（最多 5 条）', () => {
      const ctx: BrowserContext = {
        enabled: true,
        currentUrl: 'https://current.com',
        currentPageTitle: null,
        openTabs: [],
        recentPages: Array.from({ length: 8 }, (_, i) => ({
          url: `https://page${i}.com`,
          title: `Page ${i}`,
          visitedAt: new Date().toISOString(),
        })),
        sessionStartTime: new Date().toISOString(),
      };
      const section = buildBrowserPromptSection(ctx);
      // 只显示最后 5 条
      expect(section).toContain('Page 3');
      expect(section).toContain('Page 7');
      expect(section).not.toContain('Page 0');
      expect(section).not.toContain('Page 2');
    });

    it('包含工具使用提示', () => {
      const ctx: BrowserContext = {
        enabled: true,
        currentUrl: 'about:blank',
        currentPageTitle: null,
        openTabs: [],
        recentPages: [],
        sessionStartTime: new Date().toISOString(),
      };
      const section = buildBrowserPromptSection(ctx);
      expect(section).toContain('browse_page');
      expect(section).toContain('browse_snapshot');
      expect(section).toContain('browse_act');
    });
  });

  describe('updateBrowserContext', () => {
    it('无上下文时不抛错', () => {
      expect(() =>
        updateBrowserContext({ currentUrl: 'https://example.com' }),
      ).not.toThrow();
    });

    it('更新 currentUrl 和 currentPageTitle', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();

      updateBrowserContext({
        currentUrl: 'https://example.com',
        currentPageTitle: 'Example',
      });

      const ctx = getBrowserContext()!;
      expect(ctx.currentUrl).toBe('https://example.com');
      expect(ctx.currentPageTitle).toBe('Example');
    });

    it('追加到 recentPages', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();

      updateBrowserContext({ currentUrl: 'https://a.com', currentPageTitle: 'A' });
      updateBrowserContext({ currentUrl: 'https://b.com', currentPageTitle: 'B' });

      const ctx = getBrowserContext()!;
      expect(ctx.recentPages).toHaveLength(2);
      expect(ctx.recentPages[0]!.url).toBe('https://a.com');
      expect(ctx.recentPages[1]!.url).toBe('https://b.com');
    });

    it('about:blank 不追加到 recentPages', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();

      updateBrowserContext({ currentUrl: 'about:blank' });

      const ctx = getBrowserContext()!;
      expect(ctx.recentPages).toHaveLength(0);
    });

    it('recentPages 上限 20 条', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();

      for (let i = 0; i < 25; i++) {
        updateBrowserContext({
          currentUrl: `https://page${i}.com`,
          currentPageTitle: `Page ${i}`,
        });
      }

      const ctx = getBrowserContext()!;
      expect(ctx.recentPages).toHaveLength(20);
      // 保留最新的 20 条（page5 ~ page24）
      expect(ctx.recentPages[0]!.url).toBe('https://page5.com');
      expect(ctx.recentPages[19]!.url).toBe('https://page24.com');
    });

    it('仅更新 currentUrl 时不影响 currentPageTitle', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();

      updateBrowserContext({
        currentUrl: 'https://a.com',
        currentPageTitle: 'Title A',
      });
      updateBrowserContext({ currentUrl: 'https://b.com' });

      const ctx = getBrowserContext()!;
      expect(ctx.currentUrl).toBe('https://b.com');
      expect(ctx.currentPageTitle).toBe('Title A');
    });
  });

  describe('_resetBrowserContext', () => {
    it('清除上下文', async () => {
      mockWarmUp.mockResolvedValue(true);
      await browserWarmUp();
      expect(getBrowserContext()).not.toBeNull();

      _resetBrowserContext();
      expect(getBrowserContext()).toBeNull();
    });
  });
});
