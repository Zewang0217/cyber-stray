import { createConsola, type Consola } from 'consola';
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
 * 全局 consola 实例（初始为占位实例）
 */
export let consola: Consola = createConsola();

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
  
  // 3. 创建新的 consola 实例
  const newConsola = createConsola({
    level: 4, // 0-5: fatal, error, warn, log, info, debug
    reporters: [], // 不使用默认 reporter，我们自己处理
  });
  
  /**
   * 创建日志处理器
   */
  function createLogHandler(level: string) {
    return function (...args: unknown[]) {
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
  }
  
  // 4. 包装所有日志方法
  (newConsola as unknown as Record<string, unknown>).fatal = createLogHandler('fatal');
  (newConsola as unknown as Record<string, unknown>).error = createLogHandler('error');
  (newConsola as unknown as Record<string, unknown>).warn = createLogHandler('warn');
  (newConsola as unknown as Record<string, unknown>).log = createLogHandler('log');
  (newConsola as unknown as Record<string, unknown>).info = createLogHandler('info');
  (newConsola as unknown as Record<string, unknown>).debug = createLogHandler('debug');
  (newConsola as unknown as Record<string, unknown>).success = createLogHandler('success');
  
  // 5. 更新导出的 consola（这会影响到所有已经导入的模块）
  // 注意：这只对之后调用 withTag() 生效，已经创建的 logger 不受影响
  Object.assign(consola, newConsola);
  
  // 6. 启动 TUI（TUI 会自己注册 onLog 回调）
  import('./tui/index.js').then(({ initTUI }) => {
    initTUI();
  });
}

// 默认导出
export const logger = consola.withTag('cyber-stray');
