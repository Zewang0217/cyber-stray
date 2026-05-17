import React, { Component } from 'react';
import { Box, Text } from 'ink';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onFatal?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error): void {
    if (this.props.onFatal) {
      this.props.onFatal();
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <Box
          flexDirection="column"
          borderStyle="double"
          borderColor="red"
          padding={1}
        >
          <Box marginBottom={1}>
            <Text bold color="red">
              TUI 渲染错误
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text color="yellow">
              {this.state.error?.message ?? '未知错误'}
            </Text>
          </Box>
          {this.state.error?.stack && (
            <Box flexDirection="column" marginBottom={1}>
              {this.state.error.stack.split('\n').slice(0, 8).map((line, i) => (
                <Text key={i} color="gray">
                  {line.trim()}
                </Text>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="cyan">
              请按 Ctrl+C 退出或修复错误后重启
            </Text>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}
