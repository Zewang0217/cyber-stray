import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
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

import { BrowserExecutor, getBrowserExecutor, _resetBrowserExecutor } from './executor.js';

// ── Mock 子进程工具 ─────────────────────────────────────────

interface MockChildProcess extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  return proc;
}

/** 模拟正常退出：写入 stdout/stderr 并触发 close */
function simulateExit(proc: MockChildProcess, code: number, stdout = '', stderr = ''): void {
  if (stdout) proc.stdout.push(stdout);
  proc.stdout.push(null);
  if (stderr) proc.stderr.push(stderr);
  proc.stderr.push(null);
  proc.emit('close', code);
}

const mockedSpawn = vi.mocked(spawn);

// ── 测试 ────────────────────────────────────────────────────

describe('BrowserExecutor', () => {
  let executor: BrowserExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new BrowserExecutor({ timeout: 30_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('execute', () => {
    it('正常执行：JSON 输出 + exit 0 → 结构化成功结果', async () => {
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const envelope = { success: true, data: { url: 'https://example.com' }, error: null };
      const promise = executor.execute('open', ['https://example.com']);
      simulateExit(proc, 0, JSON.stringify(envelope));

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'https://example.com' });
      expect(result.error).toBeNull();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('参数拼接：追加 --json --session', async () => {
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const promise = executor.execute('click', ['#btn']);
      simulateExit(proc, 0, JSON.stringify({ success: true, data: null, error: null }));
      await promise;

      expect(mockedSpawn).toHaveBeenCalledWith(
        'agent-browser',
        ['click', '#btn', '--json', '--session', 'cyber-stray'],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('自定义 session 和 binaryPath', async () => {
      const custom = new BrowserExecutor({ session: 'test-sess', binaryPath: '/usr/bin/ab' });
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const promise = custom.execute('open');
      simulateExit(proc, 0, JSON.stringify({ success: true, data: null, error: null }));
      await promise;

      expect(mockedSpawn).toHaveBeenCalledWith(
        '/usr/bin/ab',
        ['open', '--json', '--session', 'test-sess'],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('超时：AbortController 终止进程并返回错误', async () => {
      vi.useFakeTimers();
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const promise = executor.execute('open', ['https://slow.example.com']);

      // 推进到超时
      vi.advanceTimersByTime(30_001);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('超时');
      expect(result.error).toContain('open');
      expect(proc.kill).toHaveBeenCalled();
    });

    it('二进制不存在：ENOENT → 友好安装提示', async () => {
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const promise = executor.execute('open');

      const enoent = new Error('spawn agent-browser ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      proc.emit('error', enoent);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('agent-browser 未安装，请运行 pnpm setup:browser');
    });

    it('无效 JSON：stdout 非 JSON → 解析错误', async () => {
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const promise = executor.execute('open');
      simulateExit(proc, 0, 'this is not json!!!');

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('JSON 解析失败');
      expect(result.error).toContain('this is not json');
    });

    it('非零退出码：exit 1 + stderr → 失败并携带错误信息', async () => {
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const promise = executor.execute('click', ['#missing']);
      simulateExit(proc, 1, '', 'Element not found: #missing');

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Element not found: #missing');
    });

    it('非零退出码无 stderr → 显示退出码', async () => {
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const promise = executor.execute('open');
      simulateExit(proc, 2);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('退出码: 2');
    });

    it('CLI 信封 success=false → 透传错误', async () => {
      const proc = createMockProcess();
      mockedSpawn.mockReturnValue(proc as never);

      const envelope = { success: false, data: null, error: '页面加载失败' };
      const promise = executor.execute('open', ['https://bad.example.com']);
      simulateExit(proc, 0, JSON.stringify(envelope));

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('页面加载失败');
    });
  });

  describe('warmUp', () => {
    it('成功时返回 true', async () => {
      const spy = vi.spyOn(executor, 'execute').mockResolvedValue({
        success: true,
        data: null,
        error: null,
        durationMs: 100,
      });

      const ok = await executor.warmUp();

      expect(ok).toBe(true);
      expect(spy).toHaveBeenCalledWith('open');
    });

    it('失败时返回 false', async () => {
      vi.spyOn(executor, 'execute').mockResolvedValue({
        success: false,
        data: null,
        error: '超时',
        durationMs: 30_000,
      });

      const ok = await executor.warmUp();
      expect(ok).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('调用 close 命令，即使失败也不抛错', async () => {
      const spy = vi.spyOn(executor, 'execute').mockResolvedValue({
        success: false,
        data: null,
        error: 'session not found',
        durationMs: 5,
      });

      await expect(executor.shutdown()).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledWith('close');
    });
  });

  describe('isAvailable', () => {
    it('doctor 成功 → true', async () => {
      vi.spyOn(executor, 'execute').mockResolvedValue({
        success: true,
        data: { chrome: 'ok' },
        error: null,
        durationMs: 50,
      });

      expect(await executor.isAvailable()).toBe(true);
    });

    it('doctor 失败 → false', async () => {
      vi.spyOn(executor, 'execute').mockResolvedValue({
        success: false,
        data: null,
        error: 'chrome not found',
        durationMs: 50,
      });

      expect(await executor.isAvailable()).toBe(false);
    });
  });
});

describe('getBrowserExecutor 单例', () => {
  beforeEach(() => {
    _resetBrowserExecutor();
  });

  afterEach(() => {
    _resetBrowserExecutor();
  });

  it('返回同一实例', () => {
    const a = getBrowserExecutor();
    const b = getBrowserExecutor();
    expect(a).toBe(b);
  });

  it('_resetBrowserExecutor 后创建新实例', () => {
    const a = getBrowserExecutor();
    _resetBrowserExecutor();
    const b = getBrowserExecutor();
    expect(a).not.toBe(b);
  });
});
