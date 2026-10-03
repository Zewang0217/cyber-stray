/**
 * 控制面日志测试（#116）
 *
 * 契约：
 * - initLogger 后：logger.error/info 落盘 dataDir/logs/control-YYYY-MM-DD.jsonl，
 *   行为结构化 JSON（level/message/data/timestamp 齐备）
 * - 未初始化：不落盘（getLogFilePath 返回 null），仅 stdout
 * - _resetLogger 隔离测试目录
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, appendFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getLogFilePath, initLogger, logger, _resetLogger } from './logger.js';

describe('控制面 logger（#116）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-logger-'));
    initLogger(dataDir);
  });

  afterEach(() => {
    _resetLogger();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('error 落盘：JSONL 单行含 level/message/data/timestamp', () => {
    logger.error('绑定发起失败', { clientKey: '1.2.3.4', endpoint: 'get_bot_qrcode' });
    const path = getLogFilePath();
    expect(path).not.toBeNull();
    expect(path).toContain(join('logs', 'control-'));
    const line = readFileSync(path!, 'utf-8').trim().split('\n')[0]!;
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry.level).toBe('error');
    expect(entry.message).toContain('绑定发起失败');
    expect(entry.data).toMatchObject({ clientKey: '1.2.3.4', endpoint: 'get_bot_qrcode' });
    expect(typeof entry.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(entry.timestamp as string))).toBe(false);
  });

  it('info 也落盘（journald 可见结构化行），未初始化不落盘', () => {
    logger.info('服务启动', { port: 8787 });
    const lines = readFileSync(getLogFilePath()!, 'utf-8').trim().split('\n');
    expect(lines.some((l) => JSON.parse(l).level === 'info')).toBe(true);

    // 未初始化 → 无文件路径
    _resetLogger();
    expect(getLogFilePath()).toBeNull();
  });

  it('无 data 的日志行省略 data 字段（行内无空对象噪音）', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.warn('纯文本告警');
    const written = stdoutSpy.mock.calls.map((c) => String(c[0]));
    const entry = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(entry.message).toBe('纯文本告警');
    expect('data' in entry).toBe(false);
    stdoutSpy.mockRestore();
  });
});

describe('logger 健壮性（review 修复）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-logger-robust-'));
    initLogger(dataDir);
  });

  afterEach(() => {
    _resetLogger();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('磁盘写失败（ENOSPC）→ logger.error 不抛，stdout 仍输出', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // 模拟磁盘满：appendFileSync 抛 ENOSPC
    const fsSpy = vi.spyOn({ appendFileSync }, 'appendFileSync').mockImplementation(() => {
      throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' });
    });
    // 关键断言：日志失败绝不穿透调用方错误处理
    expect(() => logger.error('磁盘满测试')).not.toThrow();
    expect(stdoutSpy).toHaveBeenCalled();
    fsSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('不可序列化 data（循环引用）→ 降级不抛，仍有一条日志', () => {
    const a: Record<string, unknown> = {};
    a.self = a; // 循环引用 → JSON.stringify 抛
    expect(() => logger.error('循环引用', { data: a })).not.toThrow();
    const lines = readFileSync(getLogFilePath()!, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('Error 参数 → message 取 error.message，不进 data', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.error('处理失败', new Error('boom'));
    const written = stdoutSpy.mock.calls.map((c) => String(c[0]));
    const entry = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(entry.message).toBe('处理失败 boom');
    expect('data' in entry).toBe(false);
    stdoutSpy.mockRestore();
  });

  it('initLogger 清理 30 天前的旧 JSONL（保留期内文件不受影响）', () => {
    // 造一个 31 天前的文件名（内容任意）
    const oldDate = new Date(Date.now() - 31 * 24 * 3600_000);
    const oldName =
      `control-${oldDate.getFullYear()}-` +
      `${String(oldDate.getMonth() + 1).padStart(2, '0')}-` +
      `${String(oldDate.getDate()).padStart(2, '0')}.jsonl`;
    const oldPath = join(dataDir, 'logs', oldName);
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    writeFileSync(oldPath, '{}');
    // 重新 init 触发清理
    _resetLogger();
    initLogger(dataDir);
    expect(existsSync(oldPath)).toBe(false);
    // 今天的文件可写
    logger.info('启动');
    expect(existsSync(getLogFilePath()!)).toBe(true);
  });
});
