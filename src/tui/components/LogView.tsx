import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  tag?: string;
  message: string;
  data?: Record<string, unknown>;
}

interface LogViewProps {
  logs: LogEntry[];
  filter?: string;
}

function getLogLevelColor(level: string): string {
  switch (level.toLowerCase()) {
    case 'error':
    case 'fatal':
      return 'red';
    case 'warn':
      return 'yellow';
    case 'success':
      return 'green';
    case 'debug':
      return 'gray';
    default:
      return 'white';
  }
}

/**
 * 判断是否是重要日志
 */
function isImportantLog(log: LogEntry): boolean {
  const importantTags = [
    'main',
    'react',
    'tool:',
    'search',
    'tavily',
  ];
  const importantLevels = ['error', 'warn', 'success', 'info'];
  
  // 检查 tag
  if (log.tag && importantTags.some((tag) => log.tag?.includes(tag))) {
    return true;
  }
  
  // 检查级别
  if (importantLevels.some((level) => level.toLowerCase() === log.level.toLowerCase())) {
    return true;
  }
  
  // 检查消息内容（如果消息包含 Step 或特定关键词，也认为是重要的）
  const importantKeywords = ['[Step', 'ReAct', 'search_web', 'read_page', 'speak', 'rest'];
  if (importantKeywords.some((keyword) => log.message.includes(keyword))) {
    return true;
  }
  
  return false;
}

export function LogView({ logs, filter }: LogViewProps) {
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    let result = logs;
    
    // 只显示重要日志
    result = result.filter(isImportantLog);
    
    // 应用级别过滤
    if (filter && filter !== 'all') {
      result = result.filter((log) => log.level.toLowerCase() === filter.toLowerCase());
    }
    
    setFilteredLogs(result);
  }, [logs, filter]);

  // 只显示最近 50 条重要日志
  const displayLogs = filteredLogs.slice(-50);

  // 提取消息中的 tag（如果 log.tag 为空）
  const extractTag = (log: LogEntry): string | undefined => {
    if (log.tag) return log.tag;
    
    // 尝试从消息中提取 [Step N] 等 tag
    const stepMatch = log.message.match(/\[Step \d+\]/);
    if (stepMatch) return stepMatch[0];
    
    return undefined;
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {displayLogs.length === 0 ? (
        <Text color="gray">等待 Agent 行动...</Text>
      ) : (
        displayLogs.map((log) => {
          const tag = extractTag(log);
          return (
            <Text key={log.id} color={getLogLevelColor(log.level)}>
              [{log.level.toUpperCase().slice(0, 5)}] {log.timestamp.slice(11, 19)}{' '}
              {tag && <Text color="cyan">[{tag}]</Text>} {log.message}
            </Text>
          );
        })
      )}
    </Box>
  );
}
