import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { AgentState } from '../types.js';
import type { LogEntry as LogEntryType } from './components/LogView.js';

/**
 * 全局状态和日志存储
 */
let currentState: AgentState | undefined;
let currentLogs: LogEntryType[] = [];
let startTime = Date.now();

/**
 * 更新 Agent 状态
 */
export function updateState(state: AgentState): void {
  currentState = state;
}

/**
 * 添加日志条目
 */
export function addLog(entry: Omit<LogEntryType, 'id'>): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  currentLogs.push({ ...entry, id });
  
  // 限制日志数量，防止内存溢出
  if (currentLogs.length > 500) {
    currentLogs = currentLogs.slice(-500);
  }
}

/**
 * 获取当前状态
 */
export function getState(): AgentState | undefined {
  return currentState;
}

/**
 * 获取日志列表
 */
export function getLogs(): LogEntryType[] {
  return currentLogs;
}

/**
 * 启动 TUI
 */
export function initTUI(): void {
  startTime = Date.now();
  
  // 注册日志回调
  import('../logger.js').then(({ onLog }) => {
    onLog((entry) => {
      addLog({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.tag ? `[${entry.tag}] ${entry.message}` : entry.message,
      });
    });
  });
  
  // 检查是否支持 raw 模式
  if (!process.stdin.isTTY) {
    // 不支持 TUI，只使用文件日志
    console.error('[TUI] 当前环境不支持 TUI，仅使用文件日志');
    return;
  }
  
  try {
    render(
      <App
        startTime={startTime}
        getState={getState}
        getLogs={getLogs}
        onExit={handleExit}
      />
    );
  } catch (error) {
    console.error('[TUI] 启动失败，降级到文件日志:', error);
  }
}

/**
 * 处理退出
 */
function handleExit(): void {
  console.log('\n👋 街溜子下班了...');
  process.exit(0);
}

/**
 * 获取运行时长
 */
export function getStartTime(): number {
  return startTime;
}
