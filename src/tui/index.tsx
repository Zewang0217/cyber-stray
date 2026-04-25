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
    // 不支持完整 TUI，使用简单文本模式输出重要日志
    console.log('🐕 赛博街溜子启动 (文本模式)');
    import('../logger.js').then(({ onLog: loggerOnLog }) => {
      loggerOnLog((entry) => {
        // 只显示重要日志
        if (isImportantLog(entry)) {
          const time = entry.timestamp.slice(11, 19);
          console.log(`[${time}] ${entry.message}`);
        }
      });
    });
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
 * 判断是否是重要日志（用于文本模式）
 */
function isImportantLog(entry: any): boolean {
  const keywords = ['[Step', 'ReAct', 'search_web', 'read_page', 'speak', 'rest', '启动', '结束'];
  return keywords.some((kw) => entry.message.includes(kw));
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
