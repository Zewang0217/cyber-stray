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
    'tool:search_web',
    'tool:read_page',
    'tool:speak',
    'tool:rest',
    'search',
    'tavily',
  ];
  const importantLevels = ['error', 'warn', 'success'];
  
  return (
    importantTags.some((tag) => log.tag?.includes(tag)) ||
    importantLevels.some((level) => level.toLowerCase() === log.level.toLowerCase())
  );
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      {displayLogs.length === 0 ? (
        <Text color="gray">等待 Agent 行动...</Text>
      ) : (
        displayLogs.map((log) => (
          <Text key={log.id} color={getLogLevelColor(log.level)}>
            [{log.level.toUpperCase().slice(0, 5)}] {log.timestamp.slice(11, 19)}{' '}
            {log.tag && <Text color="cyan">[{log.tag}]</Text>} {log.message}
          </Text>
        ))
      )}
    </Box>
  );
}
