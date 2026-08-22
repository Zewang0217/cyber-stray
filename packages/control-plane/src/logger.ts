/**
 * 控制面日志（#116）——consola 单例 + JSONL 双写
 *
 * - stdout：结构化 JSON 单行（生产 journald 捕获；非彩色纯文本——可被
 *   journalctl 按字段过滤）
 * - 文件：dataDir/logs/control-YYYY-MM-DD.jsonl（与 agent 的 logs/ 同目录
 *   约定；按天分文件，启动时清理 N 天前的旧文件防无界磁盘占用）
 *
 * **best-effort 硬约束**：日志写入（序列化/磁盘/管道）失败**绝不抛**——
 * 日志系统自身抛错会打断调用方（尤其错误处理路径：onError 的 JSON 500、
 * 路由 catch 的 502/429），反而让错误丢失。reporter 内所有失败降级为
 * 静默丢弃（错误详情留在已成功写出的部分里）。
 *
 * 模块级单例：路由/调度器/网关直接 import logger 使用。initLogger(dataRoot)
 * 在进程启动时调用一次；测试用 _resetLogger 重置目录隔离。
 */

import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createConsola, type ConsolaReporter, type LogObject } from 'consola';

/** 结构化日志行（stdout 与文件同构） */
export interface LogEntry {
  timestamp: string;
  level: string;
  tag?: string;
  message: string;
  data?: Record<string, unknown>;
}

/** JSONL 文件保留天数（启动清理；日志低频，30 天足够事故追溯） */
export const LOG_RETENTION_DAYS = 30;

let logDir: string | null = null;

/** 初始化文件日志目录（进程启动调用；未初始化 = 仅 stdout，测试可依赖） */
export function initLogger(dataRoot: string): void {
  logDir = join(dataRoot, 'logs');
  sweepOldLogs();
}

/** 今日日志文件路径（测试断言用；未初始化返回 null） */
export function getLogFilePath(): string | null {
  if (!logDir) return null;
  const d = new Date();
  const name =
    `control-${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}.jsonl`;
  return join(logDir, name);
}

/** 删除 N 天前的 control-*.jsonl（防无界磁盘占用；失败不阻塞启动） */
function sweepOldLogs(): void {
  if (!logDir) return;
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600_000;
  try {
    for (const file of readdirSync(logDir)) {
      const m = /^control-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
      if (!m) continue;
      if (new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) {
        rmSync(join(logDir, file), { force: true });
      }
    }
  } catch {
    // 目录不存在/清理失败：不影响日志主路径
  }
}

/** 序列化单个参数：Error 取 message（JSON.stringify(Error) 是空对象） */
function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** 构建日志行；任何序列化失败降级为可序列化摘要（不抛） */
function buildEntry(logObj: LogObject): LogEntry {
  // consola 约定：末尾纯对象参数（非 Error/数组）作为 data 提取，不进 message
  const args = [...logObj.args];
  const last = args[args.length - 1];
  let data: Record<string, unknown> | undefined;
  if (last && typeof last === 'object' && !(last instanceof Error) && !Array.isArray(last)) {
    data = last as Record<string, unknown>;
    args.pop();
  }
  return {
    timestamp: logObj.date.toISOString(),
    level: logObj.type,
    ...(logObj.tag ? { tag: logObj.tag } : {}),
    message: args.map(stringifyArg).join(' '),
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };
}

const jsonReporter: ConsolaReporter = {
  log(logObj: LogObject) {
    // 序列化在入口一次完成并缓存：data 含循环引用/BigInt 等不可序列化值 →
    // 降级为摘要行（日志本身绝不抛，也不让 write 时的 stringify 炸掉双写）
    let line: string;
    try {
      line = JSON.stringify(buildEntry(logObj));
    } catch {
      const fallback = {
        timestamp: logObj.date.toISOString(),
        level: logObj.type,
        message: logObj.args
          .map((a) => (typeof a === 'string' ? a : String(a)))
          .join(' ')
          .slice(0, 2000),
      };
      line = JSON.stringify(fallback);
    }
    try {
      // stdout：结构化 JSON（journald 逐行捕获）；EPIPE 等失败不影响文件
      process.stdout.write(line + '\n');
    } catch {
      // 忽略 stdout 失败
    }
    if (logDir) {
      try {
        mkdirSync(logDir, { recursive: true });
        appendFileSync(getLogFilePath()!, line + '\n', 'utf-8');
      } catch {
        // 磁盘满/目录不可写：日志 best-effort，绝不打断调用方错误处理
      }
    }
  },
};

/** 控制面日志实例（level 4 = info 及以上；错误低频，无需降噪） */
export const logger = createConsola({ level: 4, reporters: [jsonReporter] });

/** 测试重置（日志目录隔离；生产不调用） */
export function _resetLogger(): void {
  logDir = null;
}
