import { describe, test, expect, vi, beforeEach } from 'vitest';
import { AgentlyCLI } from './cli.js';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({ execSync: vi.fn() }));

describe('AgentlyCLI', () => {
  let cli: AgentlyCLI;
  beforeEach(() => { vi.clearAllMocks(); cli = new AgentlyCLI(); });

  test('send invokes agently-cli with escaped content', () => {
    vi.mocked(execSync).mockReturnValue('ok');
    cli.send('test "content"');
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('agently-cli'), expect.any(Object));
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('test \\"content\\"'), expect.any(Object));
  });

  test('getEmail returns trimmed +me output', () => {
    vi.mocked(execSync).mockReturnValue('  agent@qq.com  ');
    expect(cli.getEmail()).toBe('agent@qq.com');
  });

  test('readRecent returns parsed emails', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      { from: 'a@q.com', subject: 'hi', body: 'hello', date: '2026-01-01' },
    ]));
    const emails = cli.readRecent(3);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.from).toBe('a@q.com');
  });

  test('readRecent returns [] on CLI error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('CLI not found'); });
    expect(cli.readRecent(5)).toEqual([]);
  });
});
