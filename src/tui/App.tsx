import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { AgentState } from '../types.js';
import { StatusBar } from './components/StatusBar.js';
import { LogView, type LogEntry } from './components/LogView.js';
import { Loading } from './components/Loading.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

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

function AppInner({ startTime, getState, getLogs, onExit }: AppProps) {
  const { stdout } = useStdout();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentState, setAgentState] = useState<AgentState | undefined>();
  const [filter, setFilter] = useState<string>('all');
  const [showHelp, setShowHelp] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentAction, setCurrentAction] = useState('');
  const [terminalRows, setTerminalRows] = useState(stdout?.rows ?? 40);

  const prevLogCountRef = useRef(-1);
  const prevMoodRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setTerminalRows(stdout.rows);
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    const interval = setInterval(() => {
      const latestLogs = getLogs();
      const latestState = getState();
      const logCount = latestLogs.length;

      if (latestState && latestState.mood !== prevMoodRef.current) {
        prevMoodRef.current = latestState.mood;
        setAgentState(latestState);
      } else if (latestState && prevMoodRef.current === undefined) {
        prevMoodRef.current = latestState.mood;
        setAgentState(latestState);
      }

      if (logCount > 0 && logCount !== prevLogCountRef.current) {
        prevLogCountRef.current = logCount;
        setLogs([...latestLogs]);

        const recent = latestLogs.slice(-5);
        for (const log of recent) {
          if (!log.tag) continue;

          if (log.tag === 'react') {
            if (log.message.includes('启动')) {
              setIsAgentRunning(true);
            } else if (log.message.includes('结束') || log.message.includes('本次游荡结束')) {
              setIsAgentRunning(false);
              setCurrentAction('');
            }
          }

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

  // 固定行数估算:
  // StatusBar: ~3 (含边框)
  // Loading:   ~2 (含 margin)
  // 日志标题:   1
  // 日志顶部 margin: 1
  // Help 面板: ~5 (含边框+内边距+margin, 仅展开时)
  // 底部栏:    ~2 (含边框+margin)
  const helpRows = showHelp ? 5 : 0;
  const fixedHeaderRows = 3 + 2 + 1 + 1;
  const fixedFooterRows = helpRows + 2;
  const visibleLines = Math.max(3, terminalRows - fixedHeaderRows - fixedFooterRows);

  return (
    <Box flexDirection="column" height={terminalRows} overflow="hidden">
      {/* 固定头部 */}
      <Box flexDirection="column" flexShrink={0}>
        <StatusBar state={agentState} startTime={startTime} />
        <Loading
          isRunning={isAgentRunning}
          step={currentStep || undefined}
          action={currentAction}
        />
        <Box marginTop={1} marginBottom={1}>
          <Text bold>
            操作日志
            {filter !== 'all' && (
              <Text color="yellow"> [过滤：{filter.toUpperCase()}]</Text>
            )}
          </Text>
        </Box>
      </Box>

      {/* 可滚动日志区域 */}
      <Box flexGrow={1} flexShrink={1} overflowY="hidden">
        <LogView logs={logs} filter={filter} visibleLines={visibleLines} />
      </Box>

      {/* 固定底部 */}
      <Box flexDirection="column" flexShrink={0}>
        {showHelp && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            padding={1}
            marginBottom={1}
          >
            <Text bold color="yellow">快捷键</Text>
            <Text>  q - 退出  |  Ctrl+C - 优雅退出</Text>
            <Text>  f - 切换过滤级别</Text>
            <Text>  h - 显示/隐藏帮助</Text>
          </Box>
        )}

        <Box borderStyle="single" paddingX={1}>
          <Text color="gray">
            q 退出 | f 过滤 | h 帮助 | ↑↓/jk 滚动 | 过滤：{filter.toUpperCase()}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function App(props: AppProps) {
  return (
    <ErrorBoundary onFatal={props.onExit}>
      <AppInner {...props} />
    </ErrorBoundary>
  );
}
