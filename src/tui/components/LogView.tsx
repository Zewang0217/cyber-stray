import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

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
  visibleLines: number;
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'red',
  fatal: 'red',
  warn: 'yellow',
  success: 'green',
  debug: 'gray',
};

function levelColor(level: string): string {
  return LEVEL_COLORS[level.toLowerCase()] ?? 'white';
}

const IMPORTANT_TAGS = [
  'main',
  'react',
  'tool:',
  'search',
  'tavily',
  'speak',
  'page-reader',
];

const IMPORTANT_LEVELS = ['error', 'warn', 'success', 'info'];

const IMPORTANT_KEYWORDS = [
  '[Step',
  'ReAct',
  'search_web',
  'read_page',
  'speak',
  'rest',
];

function isImportantLog(log: LogEntry): boolean {
  if (log.tag && IMPORTANT_TAGS.some((t) => log.tag!.includes(t))) return true;
  if (IMPORTANT_LEVELS.includes(log.level.toLowerCase())) return true;
  if (IMPORTANT_KEYWORDS.some((kw) => log.message.includes(kw))) return true;
  return false;
}

export function LogView({ logs, filter, visibleLines }: LogViewProps) {
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const prevLogCountRef = useRef(-1);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    let result = logs;

    if (filter && filter !== 'all') {
      result = result.filter(
        (log) => log.level.toLowerCase() === filter.toLowerCase(),
      );
    } else {
      result = result.filter(isImportantLog);
    }

    const newCount = result.length;
    const prevCount = prevLogCountRef.current;

    setFilteredLogs(result);
    prevLogCountRef.current = newCount;

    if (!userScrolledRef.current && newCount > prevCount) {
      setScrollOffset(0);
    }
  }, [logs, filter]);

  const maxOffset = Math.max(0, filteredLogs.length - visibleLines);
  const safeOffset = Math.min(scrollOffset, maxOffset);

  const scrollTo = useCallback((offset: number) => {
    const clamped = Math.max(0, Math.min(offset, maxOffset));
    setScrollOffset(clamped);
    userScrolledRef.current = clamped > 0;
  }, [maxOffset]);

  const scrollToBottom = useCallback(() => {
    setScrollOffset(0);
    userScrolledRef.current = false;
  }, []);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      scrollTo(safeOffset + 1);
    } else if (key.downArrow || input === 'j') {
      if (safeOffset <= 0) {
        scrollToBottom();
      } else {
        scrollTo(safeOffset - 1);
      }
    } else if (key.pageDown) {
      scrollTo(safeOffset - visibleLines);
    } else if (key.pageUp) {
      scrollTo(safeOffset + visibleLines);
    } else if (key.home) {
      scrollTo(maxOffset);
    } else if (key.end) {
      scrollToBottom();
    }
  });

  const startIndex = Math.max(0, filteredLogs.length - visibleLines - safeOffset);
  const endIndex = Math.min(filteredLogs.length, startIndex + visibleLines);
  const displayLogs = filteredLogs.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
        {displayLogs.length === 0 ? (
          <Text color="gray">等待 Agent 行动...</Text>
        ) : (
          <>
            {safeOffset > 0 && (
              <Text color="gray" dimColor>
                ↑ {safeOffset} 行已滚动 ↑
              </Text>
            )}
            {displayLogs.map((log) => {
              const tag = log.tag ?? extractTag(log.message);
              return (
                <Text key={log.id} color={levelColor(log.level)}>
                  [{log.level.toUpperCase().slice(0, 5)}]{' '}
                  {log.timestamp.slice(11, 19)}{' '}
                  {tag && <Text color="cyan">[{tag}]</Text>} {log.message}
                </Text>
              );
            })}
          </>
        )}
      </Box>
      {filteredLogs.length > visibleLines && (
        <Box flexShrink={0}>
          <Text color="gray" dimColor>
            [{Math.min(filteredLogs.length, endIndex)}/{filteredLogs.length}]
            {safeOffset > 0 && ` 已滚动 ${safeOffset} 行`}
            {safeOffset > 0 && '  |  End 回到底部'}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function extractTag(message: string): string | undefined {
  return message.match(/\[Step \d+\]/)?.[0];
}
