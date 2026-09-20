/**
 * agent CLI 子进程客户端（基础设施层）
 *
 * CP 与 agent 的进程边界之一：spawn agent 仓库的 feedback-cli 短命进程，
 * 解析其 stdout 末行 JSON 协议（{ok, result?, error?}）。与 worker-runner
 * 同模式；非零退出与拉起失败显式报错（禁兜底）。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

/** agent feedback CLI 绝对路径（仓库内锚定，与 worker-runner 的 AGENT_CLI 同模式） */
export const FEEDBACK_CLI = fileURLToPath(
  new URL('../../../agent/src/worker/feedback-cli.ts', import.meta.url),
);

/** worker kill 超时：反馈处理只做文件 I/O 与轻量计算，不含 LLM，30s 足够 */
export const FEEDBACK_CLI_TIMEOUT_MS = 30_000;

/** 注入式 spawn（测试用 fake）；捕获 stdout */
export type CliSpawn = (
  cmd: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string }>;

export const realSpawn: CliSpawn = (cmd, args) => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    exitCode: number;
    stdout: string;
  }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const out: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => out.push(chunk.toString('utf8')));
  const timer = setTimeout(() => child.kill('SIGKILL'), FEEDBACK_CLI_TIMEOUT_MS);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve({ exitCode: code ?? -1, stdout: out.join('') });
  });
  return promise;
};

/**
 * 拉起 feedback-cli 并透传其 stdout 结果（一行 JSON）。
 * exitCode ≠ 0 / 协议解析失败 / 拉起异常 → { error }，由调用方决定 HTTP 映射。
 */
export async function runFeedbackCli(
  spawnFn: CliSpawn,
  command: string,
  opts: { dataDir: string; tenantId: string },
  args: string[],
): Promise<{ data?: unknown; error?: string }> {
  try {
    const { exitCode, stdout } = await spawnFn(command, [
      FEEDBACK_CLI,
      '--data-dir',
      opts.dataDir,
      ...args,
    ]);
    if (exitCode !== 0) {
      console.error(`[feedback] worker 退出码 ${exitCode}（${opts.tenantId}）`);
      return { error: '反馈处理失败' };
    }
    const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '') as {
      ok: boolean;
      result?: unknown;
      error?: string;
    };
    if (!parsed.ok) return { error: parsed.error ?? '反馈处理失败' };
    return { data: parsed.result };
  } catch (error) {
    console.error(`[feedback] 拉起失败（${opts.tenantId}）：`, error);
    return { error: '反馈处理失败' };
  }
}
