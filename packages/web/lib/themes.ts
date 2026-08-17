/**
 * 主题系统(单世界规则:配色变体,改值不改角色)
 *
 * 架构约定:
 * - 主题 = 纯 token 数据(oklch 值),本文件是唯一主题色数据源。
 * - 组件与 CSS 禁止出现主题色字面量;只能引用 var(--c-*)。
 * - 默认主题(day)的值只存在于 globals.css 的 :root(无 JS 时的兜底),
 *   因此此处 day 的 tokens 为空 —— 应用时走"清除内联样式回到 :root"路径。
 * - 非默认主题由 ThemeToggle / layout 内联脚本写入 html 的内联样式。
 * - 新增主题 = 在 THEMES 加一个对象,零 CSS/组件改动。
 */

/** 主题 token 键 = CSS 自定义属性名(与 globals.css :root 对齐) */
export interface ThemeDefinition {
  id: string;
  /** 展示名 */
  label: string;
  /** 循环切换按钮上的单字 */
  glyph: string;
  /**
   * token 值表;day 为空对象(回退 :root)。
   * 键为完整 CSS 变量名,值为 oklch() 字符串。
   */
  tokens: Record<string, string>;
}

/** 夜读烛光:纸色压暗 + 墨色提亮 + 生命色加暖 */
const NIGHT: ThemeDefinition = {
  id: "night",
  label: "夜读烛光",
  glyph: "夜",
  tokens: {
    "--c-paper": "oklch(0.22 0.018 75)",
    "--c-deep-paper": "oklch(0.19 0.016 75)",
    "--c-crust": "oklch(0.16 0.014 75)",
    "--c-ink": "oklch(0.85 0.028 85)",
    "--c-faded-ink": "oklch(0.62 0.022 85)",
    "--c-amber": "oklch(0.68 0.15 70)",
    "--c-amber-ink": "oklch(0.78 0.13 72)",
    "--c-engraving": "oklch(0.78 0.025 85)",
    "--c-engraving-fine": "oklch(0.6 0.02 85)",
    "--c-state-warn": "oklch(0.72 0.16 70)",
  },
};

/** 春·嫩竹纸:竹纸底 + 偏青墨 + 苔绿生命色 */
const SPRING: ThemeDefinition = {
  id: "spring",
  label: "春 · 嫩竹纸",
  glyph: "春",
  tokens: {
    "--c-paper": "oklch(0.91 0.035 120)",
    "--c-deep-paper": "oklch(0.87 0.035 120)",
    "--c-crust": "oklch(0.83 0.03 120)",
    "--c-ink": "oklch(0.27 0.025 130)",
    "--c-faded-ink": "oklch(0.47 0.03 130)",
    "--c-amber": "oklch(0.58 0.11 150)",
    "--c-amber-ink": "oklch(0.42 0.1 150)",
    "--c-engraving": "oklch(0.27 0.025 130)",
    "--c-engraving-fine": "oklch(0.44 0.03 130)",
    "--c-state-warn": "oklch(0.45 0.12 60)",
  },
};

/** 秋·枫纸:暖纸底 + 棕墨 + 赭石生命色 */
const AUTUMN: ThemeDefinition = {
  id: "autumn",
  label: "秋 · 枫纸",
  glyph: "秋",
  tokens: {
    "--c-paper": "oklch(0.89 0.045 60)",
    "--c-deep-paper": "oklch(0.85 0.045 60)",
    "--c-crust": "oklch(0.81 0.04 60)",
    "--c-ink": "oklch(0.28 0.03 45)",
    "--c-faded-ink": "oklch(0.47 0.035 45)",
    "--c-amber": "oklch(0.58 0.13 50)",
    "--c-amber-ink": "oklch(0.43 0.12 50)",
    "--c-engraving": "oklch(0.28 0.03 45)",
    "--c-engraving-fine": "oklch(0.45 0.035 45)",
    "--c-state-warn": "oklch(0.45 0.14 40)",
  },
};

/** 主题循环顺序;day 永远第一(默认) */
export const THEMES: ThemeDefinition[] = [
  { id: "day", label: "日间图鉴", glyph: "日", tokens: {} },
  NIGHT,
  SPRING,
  AUTUMN,
];

export const DEFAULT_THEME_ID = "day";
export const THEME_STORAGE_KEY = "cyber-stray-theme";

/** 按 id 查主题;未知 id 回退默认 */
export function findTheme(id: string | null): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/** 应用主题:写 html 内联样式 + localStorage + data-theme。仅客户端调用。 */
export function applyTheme(theme: ThemeDefinition): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // 先清掉旧主题的内联 token(切回 day 时也自然回退 :root)
  for (const t of THEMES) {
    for (const key of Object.keys(t.tokens)) root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(key, value);
  }
  root.dataset.theme = theme.id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // 隐私模式等存储不可用:仅本次会话生效
  }
}
