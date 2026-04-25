import { createConsola, type Consola, type ConsolaReporter } from 'consola';
import { writeLog, initFileLogger } from './logger/file-writer.js';
import { Writable } from 'stream';

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
export const logCallbacks: LogCallback[] = [];

/**
 * 注册日志回调（TUI 使用）
 */
export function onLog(callback: LogCallback): void {
  logCallbacks.push(callback);
}

/**
 * 创建一个空的输出流（用于禁用终端输出）
 */
const nullStream = new Writable({
  write(chunk, encoding, callback) {
    // 不输出任何内容
    callback();
  },
});

/**
 * 创建文件日志 Reporter（不输出到终端）
 */
function createFileReporter(): ConsolaReporter {
  return {
    log(logObj: any) {
      const message = logObj.args
        .map((arg: unknown) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
      
      // 写入文件
      writeLog(logObj.level, message, logObj.data as Record<string, unknown>);
      
      // 通知所有回调（TUI）
      logCallbacks.forEach((cb) =>
        cb({
          timestamp: logObj.date.toISOString(),
          level: logObj.level,
          tag: logObj.tag,
          message,
          data: logObj.data as Record<string, unknown>,
        })
      );
      
      // 不输出到终端（静默）
    },
  };
}

/**
 * 创建文件日志 Reporter 实例（在 consola 创建前就定义）
 */
const fileReporter: ConsolaReporter = {
  log(logObj: any) {
    const message = logObj.args
      .map((arg: unknown) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    
    // 写入文件（传入数字级别）
    writeLog(logObj.level, message, logObj.data as Record<string, unknown>);
    
    // 通知所有回调（TUI）
    // 调试：检查回调列表
    if (logCallbacks.length === 0) {
      // 静默，不输出
    } else {
      logCallbacks.forEach((cb) =>
        cb({
          timestamp: logObj.date.toISOString(),
          level: String(logObj.level),
          tag: logObj.tag,
          message,
          data: logObj.data as Record<string, unknown>,
        })
      );
    }
  },
};

/**
 * 默认 consola 实例（所有模块共享，禁用终端输出）
 */
export const consola: Consola = createConsola({
  level: 4,
  reporters: [fileReporter], // 一开始就添加 reporter
  stdout: nullStream as unknown as NodeJS.WriteStream,
  stderr: nullStream as unknown as NodeJS.WriteStream,
});

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

export const logger = consola.withTag('cyber-stray');
