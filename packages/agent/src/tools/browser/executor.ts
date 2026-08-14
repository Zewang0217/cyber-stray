import { spawn, type ChildProcess } from 'node:child_process';
import { consola } from '../../logger.js';
import { getConfig } from '../../config.js';
import type { AgentBrowserEnvelope, BrowserCommandResult, BrowserExecutorOptions } from './types.js';

const logger = consola.withTag('browser:executor');

const DEFAULT_SESSION = 'cyber-stray';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_BINARY = 'agent-browser';

export class BrowserExecutor {
  private readonly session: string;
  private readonly timeout: number;
  private readonly binaryPath: string;
  private readonly restore: boolean;
  private readonly encryptionKey: string | undefined;

  constructor(options?: BrowserExecutorOptions) {
    this.session = options?.session ?? DEFAULT_SESSION;
    this.timeout = options?.timeout ?? (Number(process.env.AGENT_BROWSER_TIMEOUT) || DEFAULT_TIMEOUT);
    this.binaryPath = options?.binaryPath ?? DEFAULT_BINARY;
    this.restore = options?.restore ?? true;
    this.encryptionKey = options?.encryptionKey;
  }

  /**
   * 执行 agent-browser CLI 命令，返回结构化结果。
   *
   * spawn 异步调用，统一追加 `--json --session <name>` 参数。
   * restore 模式追加 `--restore`（cookies + localStorage 跨重启持久化）。
   */
  async execute(command: string, args: string[] = []): Promise<BrowserCommandResult> {
    const startTime = performance.now();
    const fullArgs = [command, ...args, '--json', '--session', this.session];
    if (this.restore) fullArgs.push('--restore');

    logger.debug(`执行: ${this.binaryPath} ${fullArgs.join(' ')}`);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeout);

    try {
      return await new Promise<BrowserCommandResult>((resolve) => {
        let settled = false;

        const settle = (result: BrowserCommandResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };

        const makeResult = (
          success: boolean,
          data: Record<string, unknown> | null,
          error: string | null,
        ): BrowserCommandResult => ({
          success,
          data,
          error,
          durationMs: Math.round(performance.now() - startTime),
        });

        let child: ChildProcess;
        try {
          child = spawn(this.binaryPath, fullArgs, {
            signal: ac.signal,
            env: {
              ...process.env,
              // #54: 禁用空闲超时（Cyber Stray 心跳间隔可能 >1h）
              AGENT_BROWSER_IDLE_TIMEOUT_MS: '0',
              // #54: 加密 state 文件（AES-256-GCM）
              ...(this.encryptionKey
                ? { AGENT_BROWSER_ENCRYPTION_KEY: this.encryptionKey }
                : {}),
            },
          });
        } catch (err) {
          // spawn 本身同步抛错（极少见）
          const message = err instanceof Error ? err.message : String(err);
          settle(makeResult(false, null, message));
          return;
        }

        // 超时 → 主动终止进程并返回错误
        ac.signal.addEventListener('abort', () => {
          child.kill();
          logger.warn(`命令超时（${this.timeout}ms）: ${command}`);
          settle(makeResult(false, null, `命令超时（${this.timeout}ms）: ${command}`));
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
          if (ac.signal.aborted) {
            // 超时触发的 abort，已由 abort listener 处理
            return;
          }
          if (err.code === 'ENOENT') {
            logger.error('agent-browser 未安装');
            settle(makeResult(false, null, 'agent-browser 未安装，请运行 pnpm setup:browser'));
          } else {
            logger.error(`进程错误: ${err.message}`);
            settle(makeResult(false, null, err.message));
          }
        });

        child.on('close', (code) => {
          if (ac.signal.aborted) {
            // 超时触发的 abort，已由 abort listener 处理
            return;
          }

          if (code !== 0) {
            const errorMsg = stderr.trim() || `进程退出码: ${code}`;
            logger.warn(`命令失败 (exit ${code}): ${command}`, { stderr: errorMsg });
            settle(makeResult(false, null, errorMsg));
            return;
          }

          // 解析 JSON 信封
          try {
            const envelope = JSON.parse(stdout) as AgentBrowserEnvelope;
            settle(makeResult(envelope.success, envelope.data, envelope.error));
          } catch {
            logger.warn(`JSON 解析失败: ${stdout.slice(0, 200)}`);
            settle(makeResult(false, null, `JSON 解析失败: ${stdout.slice(0, 200)}`));
          }
        });
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** 预热浏览器（清理残留 + 打开 about:blank），返回是否成功 */
  async warmUp(): Promise<boolean> {
    logger.info('预热浏览器...');
    // #50: 清理上次崩溃可能遗留的残留 session（忽略错误）
    const closeResult = await this.execute('close');
    if (!closeResult.success) {
      logger.debug(`清理残留 session（预期可能失败）: ${closeResult.error}`);
    }
    const result = await this.execute('open');
    if (result.success) {
      logger.info(`浏览器预热完成 (${result.durationMs}ms)`);
    } else {
      logger.warn(`浏览器预热失败: ${result.error}`);
    }
    return result.success;
  }

  /** 关闭浏览器会话，忽略错误 */
  async shutdown(): Promise<void> {
    logger.info('关闭浏览器会话...');
    const result = await this.execute('close');
    if (!result.success) {
      logger.debug(`关闭会话时出错（已忽略）: ${result.error}`);
    }
  }

  /** 检查 agent-browser 是否可用 */
  async isAvailable(): Promise<boolean> {
    const result = await this.execute('doctor');
    return result.success;
  }
}

// ── 模块级单例（按会话键化）──────────────────────────────────────────────

/**
 * 按 session 键化：warmup 时用租户 config 的 sessionName 建实例（含该租户
 * 加密 key），工具侧 `getBrowserExecutor()` 解析当前生效配置的同一 session，
 * 两者命中同一实例。单进程多租户共享同一 session 时浏览器进程本身共享
 *（浏览器是进程级资源），上下文与 key 仍按租户数据目录隔离。
 */
const executorCache = new Map<string, BrowserExecutor>();

export function getBrowserExecutor(options?: BrowserExecutorOptions): BrowserExecutor {
  const session =
    options?.session ?? getConfig().browser?.sessionName ?? DEFAULT_SESSION;
  if (!executorCache.has(session)) {
    executorCache.set(session, new BrowserExecutor(options));
  }
  return executorCache.get(session)!;
}

/** 测试隔离：重置单例 */
export function _resetBrowserExecutor(): void {
  executorCache.clear();
}
