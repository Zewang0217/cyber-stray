import { createConsola } from 'consola';
import { writeLog, initFileLogger } from './logger/file-writer.js';

/**
 * 日志条目类型
 */
interface LogEntry {
  timestamp: string;
  level: string;
  tag?: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * 日志回调类型
 */
type LogCallback = (entry: LogEntry) => void;

/**
 * 日志回调列表
 */
const logCallbacks: LogCallback[] = [];

/**
 * 注册日志回调（TUI 使用）
 */
export function onLog(callback: LogCallback): void {
  logCallbacks.push(callback);
}

/**
 * 创建全局 consola 实例
 */
const consola = createConsola({
  level: 4, // 0-5: fatal, error, warn, log, info, debug
  reporters: [], // 不使用默认 reporter，我们自己处理
});

/**
 * 创建日志处理器
 */
function createLogHandler(level: string) {
  const handler = function (this: unknown, ...args: unknown[]) {
    const timestamp = new Date().toISOString();
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    
    const entry: LogEntry = {
      timestamp,
      level,
      message,
    };
    
    // 写入文件
    writeLog(level, message);
    
    // 通知所有回调（包括 TUI）
    logCallbacks.forEach((cb) => cb(entry));
  };
  
  // 添加 raw 方法
  handler.raw = function (this: unknown, args: unknown[]) {
    return handler(...args);
  };
  
  return handler;
}

consola.fatal = createLogHandler('fatal');
consola.error = createLogHandler('error');
consola.warn = createLogHandler('warn');
consola.log = createLogHandler('log');
consola.info = createLogHandler('info');
consola.debug = createLogHandler('debug');
consola.success = createLogHandler('success');

/**
 * 初始化日志系统
 */
export function initLogger(): void {
  // 1. 初始化文件日志
  initFileLogger();
  
  // 2. 初始化日志清理
  import('./logger/log-cleaner.js').then(({ initLogCleaner }) => {
    initLogCleaner();
  });
  
  // 3. 启动 TUI（TUI 会自己注册 onLog 回调）
  import('./tui/index.js').then(({ initTUI }) => {
    initTUI();
  });
}

export { consola };
export const logger = consola.withTag('cyber-stray');
