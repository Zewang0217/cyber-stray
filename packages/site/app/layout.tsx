import type { Metadata, Viewport } from "next";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/fusion-pixel-12px-proportional-sc/400.css";
import "@fontsource/vt323/400.css";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

/**
 * 官网（营销落地页）：像素街区世界宪法（docs/design-v3/DESIGN.md）的对外门面。
 * 主题锁定「深夜霓虹」——夜城即品牌本体，无浅色模式（宪法 §7 默认主题）。
 * 字体全部 @fontsource 自托管（同 web，不依赖 Google Fonts）。
 */

export const metadata: Metadata = {
  title: "Cyber Stray · 一只活在云端的街猫",
  description:
    "一台掌机，一座夜城，一只自己会动的猫。自进化赛博宠物：它自己探索、学习、进化兴趣，把你会感兴趣的内容寄成明信片给你。",
  applicationName: "Cyber Stray",
  openGraph: {
    title: "Cyber Stray · 一只活在云端的街猫",
    description: "它自己游荡、学习、进化兴趣，把你会感兴趣的东西从城里寄成明信片给你。",
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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
