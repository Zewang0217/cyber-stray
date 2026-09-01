import type { Metadata, Viewport } from "next";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/500-italic.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/eb-garamond/600-italic.css";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "@fontsource/caveat/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/400-italic.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageTransition } from "@/components/layout/PageTransition";
import { PaperTexture } from "@/components/effects/PaperTexture";
import { THEMES, THEME_STORAGE_KEY } from "@/lib/themes";

/**
 * Direction contract (impeccable new-work Step 5):
 *
 * THESIS: 赛博宠物视觉化为会动的维多利亚自然博物图鉴,拒绝仪表盘堆卡片 + Tamagotchi 萌系。
 * OWN-WORLD: 做旧泛黄纸底 + 棕墨铜版画 line engraving + 琥珀生命色;EB Garamond 衬线 + Caveat 手写注解 + IBM Plex Mono 等宽读数;宠物=图鉴页面会动铜版画插画(idle 帧动画)。
 * STORY: 打开→图鉴里插画活着(idle 证明它活着)→ 状态读数随 tick 被采集者「修订」→ 推送流新贴发现 stagger 进来→ 点推送反馈标注→ 兴趣图谱里宠物自己改的节点带琥珀呼吸光(自进化可见)→ 轻交互插画抬头/摇尾(只改 mood 不改生存)。
 * FIRST VIEWPORT: 图鉴页面(插画活着 + 手写拉丁名 + 采集笔记),下方状态读数行(等宽数字 + 手写注解),中下推送流(stagger reveal),侧/下兴趣图谱(自改节点呼吸光)+ 足迹地图。
 * FORM: 维多利亚自然博物图鉴,用户选定;Restrained 配色(纸/墨/生命色);主题系统=数据驱动(lib/themes.ts),组件零主题色字面量。
 * FONTS: 本地化 @fontsource(国内服务器构建不依赖 Google Fonts 可达);--font-* 变量定义在 globals.css :root。
 */

export const metadata: Metadata = {
  title: "Cyber Stray | 赛博街溜子",
  description: "一只在云端自主游荡的赛博宠物,活在会动的维多利亚自然博物图鉴里",
  openGraph: {
    title: "Cyber Stray | 赛博街溜子",
    description: "一只在云端自主游荡的赛博宠物,活在会动的维多利亚自然博物图鉴里",
    type: "website",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary",
    title: "Cyber Stray | 赛博街溜子",
    description: "一只在云端自主游荡的赛博宠物,活在会动的维多利亚自然博物图鉴里",
  },
};

/**
 * 移动浏览器 chrome 色随 OS 明暗取纸色(默认日间纸 / 深色系统用夜读纸)。
 * 应用内四卷主题(夜/春/秋)为运行时数据驱动,无法静态跟随——取日/夜两档即可。
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.22 0.018 75)" },
    { color: "oklch(0.92 0.03 85)" },
  ],
};

/** 非默认主题表(内联进防闪烁脚本;day 走 :root 兜底,无需注入) */
const NON_DAY_THEMES = JSON.stringify(
  Object.fromEntries(THEMES.filter((t) => t.id !== "day").map((t) => [t.id, t.tokens])),
);

/** 首帧前应用已存主题,避免闪烁;与 lib/themes.ts 同源 */
const THEME_BOOT_SCRIPT = `(function(){try{var T=${NON_DAY_THEMES};var id=localStorage.getItem('${THEME_STORAGE_KEY}');var m=T[id];if(m){var d=document.documentElement;for(var k in m)d.style.setProperty(k,m[k]);d.dataset.theme=id;}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex bg-base text-text" suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-boot focus:px-3 focus:py-2 focus:rounded-sm focus:bg-[var(--c-paper)] focus:border focus:border-[var(--c-engraving-fine)] focus:text-text focus:font-heading focus:text-sm"
        >
          跳到主内容
        </a>
        <Providers>
          <PaperTexture />
          <Sidebar />
          <main id="main-content" className="flex-1 lg:ml-64 relative z-10 pt-14 lg:pt-0">
            <PageTransition>
              {children}
              {/* 卷末印记(colophon):随翻页子树一起进出,避免高度突变跳位 */}
              <footer
                aria-hidden
                className="field-note text-xs text-subtext text-center pt-16 pb-8 select-none"
              >
                — 图鉴 · 采集自云端 —
              </footer>
            </PageTransition>
          </main>
        </Providers>
      </body>
    </html>
  );
}
