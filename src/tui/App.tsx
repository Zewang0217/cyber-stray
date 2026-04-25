import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
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

export function App({ startTime, getState, getLogs, onExit }: AppProps) {
  const [filter, setFilter] = useState<string>('all');
  const [showHelp, setShowHelp] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentAction, setCurrentAction] = useState('');

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

  // 检测 Agent 是否在运行（通过日志判断）
  useEffect(() => {
    if (logs.length === 0) return;

    const lastLog = logs[logs.length - 1];
    if (!lastLog) return;
    
    // 如果最后一条日志是行动相关的，说明 Agent 在运行
    const runningTags = ['tool:', 'react', 'search'];
    const isRunning = runningTags.some((tag) => lastLog.tag?.includes(tag));
    
    setIsAgentRunning(isRunning);
    
    // 提取当前步骤和行动
    if (isRunning) {
      const stepMatch = lastLog.message.match(/\[Step (\d+)\]/);
      if (stepMatch && stepMatch[1]) {
        setCurrentStep(parseInt(stepMatch[1]));
      }
      
      // 提取行动描述
      if (lastLog.tag?.includes('tool:')) {
        const action = lastLog.message.split(' ')[0] || '';
        setCurrentAction(action);
      } else if (lastLog.message.includes('ReAct Loop')) {
        setCurrentAction('启动 ReAct Loop');
      }
    }
  }, [logs]);

  return (
    <Box flexDirection="column" height="100%">
      {/* 状态栏 */}
      <StatusBar state={state} startTime={startTime} />

      {/* Loading 动画 */}
      <Loading
        isRunning={isAgentRunning}
        step={currentStep || undefined}
        action={currentAction}
      />

      {/* 日志视图 */}
      <Box flexGrow={1} flexDirection="column" marginY={1}>
        <Box marginBottom={1}>
          <Text bold>
            操作日志
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
