import { readdir, unlink } from 'fs/promises';
import { createConsola } from 'consola';

// 创建独立的 logger 实例，避免循环依赖
const logger = createConsola({ level: 4 }).withTag('log-cleaner');

const LOG_DIR = 'data/logs';
const DEFAULT_RETENTION_DAYS = 30;

/**
 * 从文件名解析日期
 */
function parseDateFromFilename(filename: string): number | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
  if (!match || !match[1]) {
    return null;
  }
  return new Date(match[1]).getTime();
}

/**
 * 清理过期日志文件
 */
export async function cleanupOldLogs(
  retentionDays: number = DEFAULT_RETENTION_DAYS
): Promise<number> {
  try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    
    let removedCount = 0;
    const files = await readdir(LOG_DIR);
    
    for (const file of files) {
      const date = parseDateFromFilename(file);
      if (date === null) {
        continue;
      }
      
      if (date < cutoff) {
        await unlink(`${LOG_DIR}/${file}`);
        removedCount++;
        logger.info('删除过期日志', { file, date: new Date(date).toISOString() });
      }
    }
    
    if (removedCount > 0) {
      logger.info('日志清理完成', { removedCount, retentionDays });
    }
    
    return removedCount;
  } catch (error) {
    logger.error('日志清理失败', { error: String(error) });
    return 0;
  }
}

/**
 * 启动时执行一次清理
 */
export function initLogCleaner(): void {
  logger.info('初始化日志清理器');
  cleanupOldLogs().catch((err) => {
    logger.error('初始化清理失败', { error: String(err) });
  });
  
  // 每天凌晨 2 点执行清理
  const nextRun = getNextRunTime();
  const delay = nextRun - Date.now();
  
  logger.info('下次清理时间', { 
    next: new Date(nextRun).toISOString(),
    delay: `${Math.round(delay / 1000 / 60)}分钟` 
  });
  
  setTimeout(() => {
    cleanupOldLogs();
    // 之后每 24 小时执行一次
    setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
  }, delay);
}

/**
 * 计算下次运行时间（凌晨 2 点）
 */
function getNextRunTime(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  
  // 如果今天的 2 点已过，设置为明天 2 点
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  
  return next.getTime();
}
