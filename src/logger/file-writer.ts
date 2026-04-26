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

// 日志级别映射（consola 的级别数字越小越严重）
// LogLevels: fatal=0, error=1, warn=2, log=3, info=4, debug=5, trace=6
const LEVEL_NAMES: Record<number, string> = {
  0: 'FATAL',
  1: 'ERROR',
  2: 'WARN',
  3: 'LOG',
  4: 'INFO',
  5: 'DEBUG',
  6: 'TRACE',
};

/**
 * 格式化日志条目为易读文本格式
 * 格式：[YYYY-MM-DD HH:mm:ss] [LEVEL] [tag] message {data}
 */
function formatLogEntry(
  level: number | string,
  message: string,
  data?: Record<string, unknown>
): string {
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace('T', ' ');
  
  // 将数字级别转换为字符串
  const levelNum = typeof level === 'string' ? parseInt(level) : level;
  const levelName = LEVEL_NAMES[levelNum] || String(level);
  
  let line = `[${timestamp}] [${levelName}] ${message}`;
  
  // 如果有额外数据，追加到行尾
  if (data && Object.keys(data).length > 0) {
    const dataStr = Object.entries(data)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    line += ` {${dataStr}}`;
  }
  
  return line + '\n';
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
 * 写入日志到文件（同步版本，用于 reporter）
 */
export function writeLog(
  level: string,
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    const logPath = getTodayLogPath();
    const line = formatLogEntry(level, message, data);
    // 使用同步写入，确保日志立即写入文件
    writeFileSync(logPath, line, { flag: 'a', encoding: 'utf-8' });
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
