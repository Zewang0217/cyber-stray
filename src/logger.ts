import type { LogLevel, LogEntry } from './types';

/**
 * 简单的日志工具
 * 格式: [时间] [级别] [模块] 消息 key=value
 */
class Logger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): string {
    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase().padEnd(5);
    const moduleTag = `[${this.module}]`;
    
    let logLine = `${timestamp} ${levelUpper} ${moduleTag} ${message}`;
    
    if (data) {
      const dataStr = Object.entries(data)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      logLine += ` ${dataStr}`;
    }
    
    return logLine;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(this.formatMessage('debug', message, data));
  }

  info(message: string, data?: Record<string, unknown>): void {
    console.info(this.formatMessage('info', message, data));
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(this.formatMessage('warn', message, data));
  }

  error(message: string, data?: Record<string, unknown>): void {
    console.error(this.formatMessage('error', message, data));
  }
}

/**
 * 创建模块日志器
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}