/** agent-browser --json 统一信封 */
export interface AgentBrowserEnvelope {
  success: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
}

/** BrowserExecutor 返回 */
export interface BrowserCommandResult {
  success: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
}

/** BrowserExecutor 构造选项 */
export interface BrowserExecutorOptions {
  /** 会话名称，默认 'cyber-stray' */
  session?: string;
  /** 超时毫秒数，默认 AGENT_BROWSER_TIMEOUT 环境变量或 30000 */
  timeout?: number;
  /** 二进制路径，默认 'agent-browser' */
  binaryPath?: string;
}
