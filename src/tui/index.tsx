import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { onLog } from '../logger.js';
import type { AgentState } from '../types.js';
import type { LogEntry } from './components/LogView.js';

let currentState: AgentState | undefined;
let currentLogs: LogEntry[] = [];
let startTime = Date.now();
export function updateState(state: AgentState): void {
  currentState = state;
}

export function addLog(entry: LogEntry): void {
  currentLogs.push(entry);
  if (currentLogs.length > 500) {
    currentLogs = currentLogs.slice(-500);
  }
}

export function getState(): AgentState | undefined {
  return currentState;
}

export function getLogs(): LogEntry[] {
  return currentLogs;
}

export function initTUI(): void {
  startTime = Date.now();

  if (!process.stdin.isTTY) {
    initFallbackMode();
    return;
  }

  try {
    render(
      <App
        startTime={startTime}
        getState={getState}
        getLogs={getLogs}
        onExit={handleExit}
      />,
    );

    registerTuiLogCallback();
  } catch {
    initFallbackMode();
  }
}

function registerTuiLogCallback(): void {
  onLog((entry) => {
    addLog({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: entry.timestamp,
      level: entry.level,
      tag: entry.tag,
      message: entry.message,
    });
  });
}

function initFallbackMode(): void {
  console.log('🐕 赛博街溜子启动 (文本模式)');

  const importantKeywords = ['[Step', 'ReAct', 'search_web', 'read_page', 'speak', 'rest', '启动', '结束'];

  onLog((entry) => {
    if (importantKeywords.some((kw) => entry.message.includes(kw))) {
      const time = entry.timestamp.slice(11, 19);
      console.log(`[${time}] ${entry.message}`);
    }
  });
}

function handleExit(): void {
  process.stdout.write('\x1b[2J\x1b[H');
  console.log('👋 街溜子下班了...');
  process.exit(0);
}

export function getStartTime(): number {
  return startTime;
}
