"use client";

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * 全局 Provider 包装
 * 图鉴世界 light-first:纸色底是默认(:root token)。夜读/烛光通过
 * html.night 切换,由 ThemeToggle 直接管理 class——不再需要 next-themes。
 */
export function Providers({ children }: ProvidersProps): React.ReactElement {
  return <>{children}</>;
}
