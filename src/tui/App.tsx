import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { AgentState } from '../types.js';
import { StatusBar } from './components/StatusBar.js';
import { LogView, type LogEntry } from './components/LogView.js';
import { Loading } from './components/Loading.js';

interface AppProps {
  startTime: number;
  getState: () => AgentState | undefined;
  getLogs: () => LogEntry[];
  onExit: () => void;
}

const FILTERS = ['all', 'info', 'warn', 'error', 'debug'] as const;

function extractToolName(message: string): string {
  return message.match(/\]\s*(\w+)\b/)?.[1] ?? '';
}

export function App({ startTime, getState, getLogs, onExit }: AppProps) {
  const { stdout } = useStdout();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentState, setAgentState] = useState<AgentState | undefined>();
  const [filter, setFilter] = useState<string>('all');
  const [showHelp, setShowHelp] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentAction, setCurrentAction] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      const latestLogs = getLogs();
      const latestState = getState();

      if (latestState) {
        setAgentState(latestState);
      }

      if (latestLogs.length > 0) {
        setLogs([...latestLogs]);

        // 检测最近几条日志中的状态变化
        const recent = latestLogs.slice(-5);
        for (const log of recent) {
          if (!log.tag) continue;

          // ReAct Loop 生命周期
          if (log.tag === 'react') {
            if (log.message.includes('启动')) {
              setIsAgentRunning(true);
            } else if (log.message.includes('结束') || log.message.includes('本次游荡结束')) {
              setIsAgentRunning(false);
              setCurrentAction('');
            }
          }

          // Tool 调用
          if (log.tag.startsWith('tool:')) {
            const stepMatch = log.message.match(/\[Step (\d+)\]/);
            if (stepMatch?.[1]) {
              setCurrentStep(Number(stepMatch[1]));
            }
            setCurrentAction(extractToolName(log.message));
          }
        }
      }
    }, 200);

    return () => clearInterval(interval);
  }, [getLogs, getState]);

  useInput((input) => {
    if (input === 'q') {
      onExit();
    } else if (input === 'f') {
      const currentIndex = FILTERS.indexOf(filter as typeof FILTERS[number]);
      const nextIndex = (currentIndex + 1) % FILTERS.length;
      setFilter(FILTERS[nextIndex]!);
    } else if (input === 'h') {
      setShowHelp((prev) => !prev);
    }
  });

  // 状态栏 4 行 + Loading 2 行 + 标题 1 行 + 底部栏 1 行 + help 可展开 4 行
  const headerRows = 4 + 2 + 1;
  const footerRows = (showHelp ? 4 : 0) + 1;
  const maxLogLines = Math.max(3, (stdout?.rows ?? 40) - headerRows - footerRows - 3);

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar state={agentState} startTime={startTime} />

      <Loading
        isRunning={isAgentRunning}
        step={currentStep || undefined}
        action={currentAction}
      />

      <Box flexDirection="column" marginY={1}>
        <Box marginBottom={1}>
          <Text bold>
            操作日志
            {filter !== 'all' && (
              <Text color="yellow"> [过滤：{filter.toUpperCase()}]</Text>
            )}
          </Text>
        </Box>
        <Box height={maxLogLines}>
          <LogView logs={logs} filter={filter} maxLines={maxLogLines} />
        </Box>
      </Box>

      {showHelp && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          padding={1}
          marginBottom={1}
        >
          <Text bold color="yellow">快捷键</Text>
          <Text>  q - 退出</Text>
          <Text>  f - 切换过滤级别</Text>
          <Text>  h - 显示/隐藏帮助</Text>
        </Box>
      )}

      <Box marginTop={1} borderStyle="single" paddingX={1}>
        <Text color="gray">
          快捷键：q 退出 | f 过滤 | h 帮助 | 当前过滤：{filter.toUpperCase()}
        </Text>
      </Box>
    </Box>
  );
}
