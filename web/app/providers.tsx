"use client";

import { ThemeProvider } from "next-themes";

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * 全局 Provider 包装
 * 提供 next-themes 主题切换能力
 */
export function Providers({ children }: ProvidersProps): React.ReactElement {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      {children}
    </ThemeProvider>
  );
}
