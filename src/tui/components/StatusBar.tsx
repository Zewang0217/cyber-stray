import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState, Mood } from '../../types.js';

interface StatusBarProps {
  state?: AgentState;
  startTime: number;
}

function getMoodEmoji(mood: Mood): string {
  switch (mood) {
    case 'curious':
      return '🔍';
    case 'grumpy':
      return '😠';
    case 'playful':
      return '🎮';
    case 'lazy':
      return '😴';
    case 'excited':
      return '🤩';
    case 'emo':
      return '😔';
    default:
      return '😐';
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function StatusBar({ state, startTime }: StatusBarProps) {
  const now = Date.now();
  const uptime = now - startTime;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {/* 第一行：标题 + 时间 */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          🐕 Cyber Stray
        </Text>
        <Text color="gray">
          {new Date().toISOString().slice(11, 19)}
        </Text>
      </Box>

      {/* 第二行：状态 + 运行时长 */}
      <Box justifyContent="space-between">
        {state ? (
          <>
            <Box>
              <Text>
                {getMoodEmoji(state.mood)} B:{state.boredom}/100
              </Text>
              <Text> </Text>
              <Text color="green">
                E:{state.energy}/100
              </Text>
              <Text> </Text>
              <Text color="red">
                T:{state.temper}/100
              </Text>
            </Box>
            <Box>
              <Text color="yellow">
                ⏱ {formatDuration(uptime)}
              </Text>
            </Box>
          </>
        ) : (
          <Text color="gray">加载中...</Text>
        )}
      </Box>
    </Box>
  );
}
