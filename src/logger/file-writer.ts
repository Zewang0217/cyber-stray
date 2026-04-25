import { appendFile, mkdir } from 'fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createConsola } from 'consola';
import { Writable } from 'stream';

// 创建空输出流禁用终端输出
const nullStream = new Writable({
  write(chunk, encoding, callback) {
    callback();
  },
});

// 创建独立的 logger 实例，避免循环依赖（禁用终端输出）
const logger = createConsola({
  level: 4,
  stdout: nullStream as unknown as NodeJS.WriteStream,
  stderr: nullStream as unknown as NodeJS.WriteStream,
}).withTag('file-writer');

const LOG_DIR = 'data/logs';

/**
 * 获取今日日志文件路径
 */
function getTodayLogPath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${LOG_DIR}/${today}.log`;
}

/**
 * 格式化日志条目为 JSONL 格式
 */
function formatLogEntry(
  level: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data && { data }),
  };
  return JSON.stringify(entry) + '\n';
}

/**
 * 初始化日志目录
 */
export function initFileLogger(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
    logger.info('创建日志目录', { path: LOG_DIR });
  }
}

/**
 * 写入日志到文件
 */
export async function writeLog(
  level: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const logPath = getTodayLogPath();
    const line = formatLogEntry(level, message, data);
    await appendFile(logPath, line, 'utf-8');
  } catch (error) {
    // 文件写入失败不影响主流程
    logger.error('写入日志文件失败', { error: String(error) });
  }
}

/**
 * 同步版本（用于初始化等同步场景）
 */
export function writeLogSync(
  level: string,
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    const logPath = getTodayLogPath();
    const line = formatLogEntry(level, message, data);
    writeFileSync(logPath, line, { flag: 'a', encoding: 'utf-8' });
  } catch (error) {
    logger.error('同步写入日志文件失败', { error: String(error) });
  }
}
