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
  label: string;
}

/**
 * 从图表容器元素读 design-v3 14 色 token（globals.css :root）。
 * 叼回 = 窗黄（--window/--hi），枢纽 = 近景楼蓝，呼应「深夜街区」语义。
 */
export function readPalette(el: HTMLElement): TrailPalette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--star", "#f4f4f4"),
    muted: v("--curb", "#566c86"),
    card: v("--panel", "#2c3136"),
    accent: v("--hi", "#f7d51d"),
    accentSoft: v("--bld-far", "#29366f"),
    line: v("--street", "#333c57"),
    // 节点标注用「星白 75%」：curb 在深底上太暗，star 全亮又抢戏（token 派生，不新造色）
    label: "rgba(244,244,244,.75)",
  };
}

export const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
