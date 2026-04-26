import { createConsola, type ConsolaInstance, type ConsolaReporter } from 'consola';
import { writeLog, initFileLogger } from './logger/file-writer.js';
import { Writable } from 'stream';

interface LogEntry {
  timestamp: string;
  level: string;
  tag?: string;
  message: string;
  data?: Record<string, unknown>;
}

type LogCallback = (entry: LogEntry) => void;

export const logCallbacks: LogCallback[] = [];

export function onLog(callback: LogCallback): void {
  logCallbacks.push(callback);
}

const nullStream = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

const fileReporter: ConsolaReporter = {
  log(logObj) {
    const message = logObj.args
      .map((arg: unknown) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');

    writeLog(String(logObj.level), message, logObj.data as Record<string, unknown>);

    if (logCallbacks.length > 0) {
      logCallbacks.forEach((cb) =>
        cb({
          timestamp: logObj.date.toISOString(),
          level: logObj.type,
          tag: logObj.tag,
          message,
          data: logObj.data as Record<string, unknown>,
        }),
      );
    }
  },
};

export const consola: ConsolaInstance = createConsola({
  level: 4,
  reporters: [fileReporter],
  stdout: nullStream as unknown as NodeJS.WriteStream,
  stderr: nullStream as unknown as NodeJS.WriteStream,
});

export function initLogger(): void {
  initFileLogger();

  import('./logger/log-cleaner.js').then(({ initLogCleaner }) => {
    initLogCleaner();
  });

  import('./tui/index.js').then(({ initTUI }) => {
    initTUI();
  });
}

export const logger = consola.withTag('cyber-stray');
