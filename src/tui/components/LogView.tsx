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

export function LogView({ logs, filter }: LogViewProps) {
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>(logs);

  useEffect(() => {
    if (!filter || filter === 'all') {
      setFilteredLogs(logs);
    } else {
      setFilteredLogs(logs.filter((log) => log.level.toLowerCase() === filter.toLowerCase()));
    }
  }, [logs, filter]);

  // 只显示最近 100 条
  const displayLogs = filteredLogs.slice(-100);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {displayLogs.map((log) => (
        <Text key={log.id} color={getLogLevelColor(log.level)}>
          [{log.level.toUpperCase().slice(0, 5)}] {log.timestamp.slice(11, 19)}{' '}
          {log.message}
        </Text>
      ))}
    </Box>
  );
}
