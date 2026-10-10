/**
 * trail 视图的 ECharts 共享件：按需注册 + 调色板 + 自定义图形。
 * 调色板在渲染时读取页面 CSS 变量，暗色（data-theme="night"）刷新生效。
 */

import * as echarts from "echarts/core";
import { GraphChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  ScatterChart,
  GraphChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

export { echarts };

/** 四角星（叼回） */
export const STAR = "path://M0,-13 L3,-3 L13,0 L3,3 L0,13 L-3,3 L-13,0 L-3,-3 Z";
/** 房子（回窝） */
export const HOUSE = "path://M-8,1 L0,-8 L8,1 L6,1 L6,9 L-6,9 L-6,1 Z";

export interface TrailPalette {
  ink: string;
  muted: string;
  card: string;
  accent: string;
  accentSoft: string;
  line: string;
}

/**
 * 从图表容器元素读 --trail-* 变量（变量声明在页面容器上，CSS 自定义属性
 * 只向下继承——读 documentElement 会永远拿到回退值）。
 */
export function readPalette(el: HTMLElement): TrailPalette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--trail-ink", "#2b2620"),
    muted: v("--trail-muted", "#8a8177"),
    card: v("--trail-card", "#ffffff"),
    accent: v("--trail-accent", "#c96f2e"),
    accentSoft: v("--trail-accent-soft", "#f6e3d0"),
    line: v("--trail-line", "#e3dcd2"),
  };
}

export const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
