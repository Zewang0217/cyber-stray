import React from 'react';
import { Box, Text } from 'ink';
import type { SessionStatsSnapshot } from '../../session-stats.js';

interface StatsPanelProps {
  stats: SessionStatsSnapshot;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * 会话统计面板——紧凑单行，嵌入 TUI 底部栏上方
 */
export function StatsPanel({ stats }: StatsPanelProps) {
  const { wanderRounds, totalSteps, pushes, likes, dislikes, errors, uptimeMs } = stats;

  return (
    <Box paddingX={1}>
      <Text color="gray">
        📊 {formatUptime(uptimeMs)}
      </Text>
      <Text> </Text>
      <Text color="cyan">
        🚶{wanderRounds}轮/{totalSteps}步
      </Text>
      <Text> </Text>
      <Text color="green">
        📤{pushes}
      </Text>
      <Text> </Text>
      <Text color="magenta">
        👍{likes} 👎{dislikes}
      </Text>
      {errors > 0 && (
        <>
          <Text> </Text>
          <Text color="red">⚠{errors}</Text>
        </>
      )}
    </Box>
  );
}
