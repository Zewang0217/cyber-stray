import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AgentState } from '../types.js';
import { StatusBar } from './components/StatusBar.js';
import { LogView, type LogEntry } from './components/LogView.js';

interface AppProps {
  startTime: number;
  getState: () => AgentState | undefined;
  getLogs: () => LogEntry[];
  onExit: () => void;
}

export function App({ startTime, getState, getLogs, onExit }: AppProps) {
  const [filter, setFilter] = useState<string>('all');
  const [showHelp, setShowHelp] = useState(false);

  // 键盘输入处理
  useInput((input, key) => {
    if (input === 'q') {
      onExit();
    } else if (input === 'f') {
      // 切换过滤
      const filters: string[] = ['all', 'info', 'warn', 'error', 'debug'];
      const currentIndex = filters.indexOf(filter);
      const nextIndex = (currentIndex + 1) % filters.length;
      setFilter(filters[nextIndex] || 'all');
    } else if (input === 'h') {
      setShowHelp(!showHelp);
    }
  });

  const state = getState();
  const logs = getLogs();

  return (
    <Box flexDirection="column" height="100%">
      {/* 状态栏 */}
      <StatusBar state={state} startTime={startTime} />

      {/* 日志视图 */}
      <Box flexGrow={1} flexDirection="column" marginY={1}>
        <Box marginBottom={1}>
          <Text bold>
            日志
            {filter !== 'all' && (
              <Text color="yellow"> [过滤：{filter.toUpperCase()}]</Text>
            )}
          </Text>
        </Box>
        <LogView logs={logs} filter={filter} />
      </Box>

      {/* 帮助提示 */}
      {showHelp && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          padding={1}
          marginBottom={1}
        >
          <Text bold color="yellow">
            快捷键
          </Text>
          <Text>  q - 退出</Text>
          <Text>  f - 切换过滤级别</Text>
          <Text>  h - 显示/隐藏帮助</Text>
        </Box>
      )}

      {/* 底部提示 */}
      <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1}>
        <Text color="gray">
          快捷键：q 退出 | f 过滤 | h 帮助 | 当前过滤：{filter.toUpperCase()}
        </Text>
      </Box>
    </Box>
  );
}
