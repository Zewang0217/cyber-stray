import { createConsola, type Consola, type ConsolaReporter } from 'consola';
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
 * 创建文件日志 Reporter
 */
function createFileReporter(): ConsolaReporter {
  return {
    log(logObj: any) {
      const message = logObj.args
        .map((arg: unknown) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
      
      // 写入文件
      writeLog(logObj.level, message, logObj.data as Record<string, unknown>);
      
      // 通知所有回调
      logCallbacks.forEach((cb) =>
        cb({
          timestamp: logObj.date.toISOString(),
          level: logObj.level,
          tag: logObj.tag,
          message,
          data: logObj.data as Record<string, unknown>,
        })
      );
    },
  };
}

/**
 * 默认 consola 实例（所有模块共享）
 */
export const consola = createConsola();

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
  
  // 3. 添加 reporter 到全局 consola 实例
  // 注意：这会影响所有使用 consola 的模块
  const fileReporter = createFileReporter();
  consola.setReporters([fileReporter]);
  
  // 4. 启动 TUI（TUI 会自己注册 onLog 回调）
  import('./tui/index.js').then(({ initTUI }) => {
    initTUI();
  });
}

export const logger = consola.withTag('cyber-stray');
