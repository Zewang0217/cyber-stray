"use client";

import { useEffect, useRef } from "react";
import type { TrailEvent, TrailSession } from "@cyber-stray/shared/trail";
import { echarts, HOUSE, STAR, readPalette, trunc } from "./chart-setup";

/**
 * 足迹地图（A 视图）：x = 会话内事件序，y = 巷子泳道。
 * 折线为路径、散点为节点、markArea 为巷子底色；失败 = 虚线圆 + ✕，
 * 叼回 = 发光四角星（被拦截 = 置灰）。滚轮缩放，点击节点经 onSelect 上浮。
 */
export function TrailMap({ session, onSelect }: {
  session: TrailSession;
  onSelect: (event: TrailEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const p = readPalette(ref.current);
    const evs = session.events;
    const lanes = session.lanes;

    // 同泳道相邻节点轻微错位，减少重叠
    const ys = evs.map((e, i) => e.laneIndex + (i % 2 ? 0.13 : -0.13));
    const y = (_e: TrailEvent, i: number) => [i, ys[i]];
    const pick = (tool: string, status?: "failed" | "blocked") =>
      evs
        .map((e, i) => ({ value: y(e, i), e }))
        .filter((d) => d.e.tool === tool && (status === undefined ? !d.e.status : d.e.status === status));

    const zones = lanes.map((lane, li) => {
      const xs = evs.map((e, i) => (e.alley === lane ? i : -1)).filter((i) => i >= 0);
      return [
        {
          coord: [Math.min(...xs) - 0.7, li - 0.44],
          itemStyle: { color: "rgba(59,93,201,0.10)" },
          label: { show: true, position: "insideTopLeft" as const, formatter: lane, color: p.muted, fontSize: 13 },
        },
        { coord: [Math.max(...xs) + 0.7, li + 0.44] },
      ];
    });

    chart.setOption({
      animation: false,
      grid: { left: 40, right: 40, top: 56, bottom: 56 },
      xAxis: { show: false, type: "value", min: -1, max: evs.length },
      yAxis: { show: false, type: "value", inverse: true, min: -0.6, max: lanes.length - 0.4 },
      dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }],
      tooltip: {
        formatter: (params: unknown) => {
          const d = (params as { data?: { e?: TrailEvent } }).data;
          return d?.e?.thought ?? d?.e?.title ?? "";
        },
      },
      series: [
        {
          type: "line",
          data: evs.map((e, i) => y(e, i)),
          symbol: "none",
          silent: true,
          z: 1,
          lineStyle: { color: p.accent, width: 2.5, opacity: 0.5 },
          markArea: { silent: true, data: zones },
        },
        { type: "scatter", symbol: "diamond", symbolSize: 15, data: pick("search_web"), itemStyle: { color: p.card, borderColor: p.muted, borderWidth: 1.4 }, z: 3 },
        {
          type: "scatter", symbolSize: 17, data: pick("read_page"),
          itemStyle: { color: p.card, borderColor: p.ink, borderWidth: 1.6 },
          label: { show: true, position: "bottom", distance: 6, fontSize: 11, color: p.label, formatter: (pr: unknown) => trunc(((pr as { data: { e: TrailEvent } }).data.e.title ?? ""), 11) },
          labelLayout: { hideOverlap: true }, z: 3,
        },
        {
          // 「没进去的门」：读取失败（failed）与被安全护栏拒绝（blocked）同属虚线圆
          type: "scatter", symbolSize: 15,
          data: evs.map((e, i) => ({ value: y(e, i), e })).filter((d) => d.e.tool === "read_page" && d.e.status !== undefined),
          itemStyle: { color: "transparent", borderColor: p.muted, borderWidth: 1.3, borderType: "dashed" },
          label: { show: true, formatter: "✕", fontSize: 9, color: p.muted }, z: 3,
        },
        {
          type: "scatter", symbol: STAR, symbolSize: 32, data: pick("speak"),
          itemStyle: { color: p.accent, shadowBlur: 14, shadowColor: "rgba(247,213,29,.55)" },
          label: { show: true, position: "bottom", distance: 8, fontSize: 11, color: p.label, formatter: (pr: unknown) => trunc(((pr as { data: { e: TrailEvent } }).data.e.title ?? ""), 11) },
          labelLayout: { hideOverlap: true }, z: 4,
        },
        { type: "scatter", symbol: STAR, symbolSize: 28, data: pick("speak", "blocked"), itemStyle: { color: p.muted, opacity: 0.6 }, z: 4 },
        {
          type: "scatter", symbolSize: 11, data: pick("record_knowledge"),
          itemStyle: { color: p.accentSoft, borderColor: p.accent, borderWidth: 1.2 }, z: 3,
        },
        { type: "scatter", symbol: HOUSE, symbolSize: 24, data: pick("rest"), itemStyle: { color: p.card, borderColor: p.ink, borderWidth: 1.6 }, z: 3 },
        {
          type: "scatter", symbolSize: 12, data: pick("image_meme"),
          itemStyle: { color: p.card, borderColor: p.muted },
          label: { show: true, formatter: "✿", fontSize: 10, color: p.label }, z: 3,
        },
      ],
    });

    chart.on("click", (params) => {
      const e = (params.data as { e?: TrailEvent } | undefined)?.e;
      if (e) selectRef.current(e);
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [session]);

  return <div ref={ref} className="trail-ecbox" />;
}
