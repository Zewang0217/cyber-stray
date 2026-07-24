import React from 'react';
import { render, type Instance } from 'ink';
import { App } from './App.js';
import { onLog } from '../logger.js';
import type { AgentState } from '../types.js';
import type { LogEntry } from './components/LogView.js';

let currentState: AgentState | undefined;
let currentLogs: LogEntry[] = [];
let startTime = Date.now();

let renderInstance: Instance | null = null;
let fallbackModeActive = false;

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
    initFallbackMode('非交互式终端，TUI 不可用');
    return;
  }

  try {
    renderInstance = render(
      <App
        startTime={startTime}
        getState={getState}
        getLogs={getLogs}
        onExit={handleExit}
      />,
    );

    registerTuiLogCallback();
  } catch (error) {
    initFallbackMode(`TUI 初始化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 优雅关闭 TUI
 * - 清除屏幕
 * - 卸载 Ink 组件树
 * - 恢复终端状态
 * - 退出进程
 */
export function shutdownTUI(reason?: string): void {
  if (renderInstance) {
    try {
      renderInstance.clear();
      renderInstance.unmount();
    } catch {
      // 卸载过程中忽略错误
    }
    renderInstance = null;
  }

  process.stdout.write('\x1b[2J\x1b[H');
  const msg = reason ? `👋 街溜子下班了... (${reason})` : '👋 街溜子下班了...';
  console.log(msg);
  process.exit(0);
}

/**
 * 检查 TUI 是否处于活跃状态
 */
export function isTuiActive(): boolean {
  return renderInstance !== null;
}

/**
 * 检查是否处于 fallback 文本模式
 */
export function isFallbackMode(): boolean {
  return fallbackModeActive;
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

function initFallbackMode(reason?: string): void {
  fallbackModeActive = true;
  if (reason) {
    console.log(`🐕 赛博街溜子启动 (文本模式) — ${reason}`);
  } else {
    console.log('🐕 赛博街溜子启动 (文本模式)');
  }

  console.log('  提示: 文本模式下仅显示关键操作日志');
  console.log('  退出: 按 Ctrl+C 停止');

  const importantKeywords = ['[Step', 'ReAct', 'search_web', 'read_page', 'speak', 'rest', '启动', '结束', '游荡结束'];

  onLog((entry) => {
    if (importantKeywords.some((kw) => entry.message.includes(kw))) {
      const time = entry.timestamp.slice(11, 19);
      console.log(`[${time}] ${entry.message}`);
    }
  });
}

function handleExit(): void {
  shutdownTUI('用户按键退出');
}

export function getStartTime(): number {
  return startTime;
}
