import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

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
  maxLines?: number;
}

const LEVEL_COLORS: Record<string, string> = {
  error: "red",
  fatal: "red",
  warn: "yellow",
  success: "green",
  debug: "gray",
};

function levelColor(level: string): string {
  return LEVEL_COLORS[level.toLowerCase()] ?? "white";
}

const IMPORTANT_TAGS = [
  "main",
  "react",
  "tool:",
  "search",
  "tavily",
  "speak",
  "page-reader",
];
const IMPORTANT_LEVELS = ["error", "warn", "success", "info"];
const IMPORTANT_KEYWORDS = [
  "[Step",
  "ReAct",
  "search_web",
  "read_page",
  "speak",
  "rest",
];

function isImportantLog(log: LogEntry): boolean {
  if (log.tag && IMPORTANT_TAGS.some((t) => log.tag!.includes(t))) return true;
  if (IMPORTANT_LEVELS.includes(log.level.toLowerCase())) return true;
  if (IMPORTANT_KEYWORDS.some((kw) => log.message.includes(kw))) return true;
  return false;
}

export function LogView({ logs, filter, maxLines = 40 }: LogViewProps) {
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    let result = logs;

    if (filter && filter !== "all") {
      result = result.filter(
        (log) => log.level.toLowerCase() === filter.toLowerCase(),
      );
    } else {
      result = result.filter(isImportantLog);
    }

    setFilteredLogs(result);
  }, [logs, filter]);

  const displayLogs = filteredLogs.slice(-maxLines);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {displayLogs.length === 0 ? (
        <Text color="gray">等待 Agent 行动...</Text>
      ) : (
        displayLogs.map((log) => {
          const tag = log.tag ?? extractTag(log.message);
          return (
            <Text key={log.id} color={levelColor(log.level)}>
              [{log.level.toUpperCase().slice(0, 5)}]{" "}
              {log.timestamp.slice(11, 19)}{" "}
              {tag && <Text color="cyan">[{tag}]</Text>} {log.message}
            </Text>
          );
        })
      )}
    </Box>
  );
}

function extractTag(message: string): string | undefined {
  return message.match(/\[Step \d+\]/)?.[0];
}
