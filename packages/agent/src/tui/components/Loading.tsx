import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

interface LoadingProps {
  isRunning: boolean;
  step?: number;
  action?: string;
}

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Loading({ isRunning, step, action }: LoadingProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, 80);

    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isRunning) {
    return (
      <Box marginTop={1}>
        <Text color="green">✔ Agent 就绪</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="cyan">{frames[frameIndex]}</Text>
        <Text color="yellow"> Agent 行动中</Text>
        {step !== undefined && (
          <Text color="gray">
            {' '}
            - 第 {step} 步
          </Text>
        )}
      </Box>
      {action && (
        <Box marginLeft={2}>
          <Text color="gray">
            → {action}
          </Text>
        </Box>
      )}
    </Box>
  );
}
