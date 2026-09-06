import type { Metadata, Viewport } from "next";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/fusion-pixel-12px-proportional-sc/400.css";
import "@fontsource/vt323/400.css";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { TopBar } from "@/components/strayboy/TopBar";
import { MenuBar } from "@/components/strayboy/MenuBar";

/**
 * Direction contract（design-v3 世界宪法，2026-09 重写）：
 *
 * THESIS: 一台掌机（STRAY-BOY），一座像素夜城，一只自己会动的猫（design-v3/DESIGN.md §1）。
 * OWN-WORLD: 14 色宇宙 + 一切直角 + 实色偏移阴影 + 两帧法则（steps()，禁平滑缓动）；
 *   字体 = Press Start 2P（Display/英文数字）+ Fusion Pixel 12px（中文短标签）+ VT323（日志）+
 *   Noto Sans SC（长文铁律）+ IBM Plex Mono（日期签）。
 * STORY: 打开 → 街角猫活着（sprite 帧动画）→ 状态墨条随 SSE 跳 → 明信片寄回有编排 →
 *   拍拍有性格反馈 → 图鉴/日记/贴纸册像游戏子屏。
 * FORM: 掌机框架 = 顶栏铭牌 + 主屏（游戏层）+ 底部 4 tab 菜单条 + START 键（DESIGN.md §5）。
 *   重写计划见 docs/spec/web-rewrite.md；旧世界组件随各票重铸摘除。
 * FONTS: 本地化 @fontsource（国内服务器构建不依赖 Google Fonts）；--font-* 定义在 globals.css。
 */

export const metadata: Metadata = {
  title: "STRAY-BOY · 赛博街溜子",
  description: "一台掌机，一座夜城，一只自己会动的猫。被自己进化的好奇心驱动探索与学习的赛博宠物。",
  applicationName: "STRAY-BOY",
  openGraph: {
    title: "STRAY-BOY · 赛博街溜子",
    description: "一台掌机，一座夜城，一只自己会动的猫。",
    type: "website",
    locale: "zh_CN",
  },
};

export const viewport: Viewport = {
  themeColor: "#1A1C2C",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className="h-full antialiased">
      <body className="sb flex min-h-full flex-col bg-[var(--sky)] text-[var(--paper)]">
        <TopBar />
        <main id="main-content" className="relative flex-1 pb-16 md:pb-0">
          {children}
        </main>
        <MenuBar />
      </body>
    </html>
  );
}
