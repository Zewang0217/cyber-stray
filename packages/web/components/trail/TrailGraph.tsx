"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { GraphNode, GraphView } from "@cyber-stray/shared/trail";
import { echarts, STAR, readPalette, trunc, type ChartHandle, type EChartsType } from "./chart-setup";

/**
 * 关系图谱（F 视图）：主题枢纽 + 页面 + 记忆 + 叼回的力导向图。
 * 点击节点经 onSelect 上浮详情（跳回游荡由详情面板显式触发）；
 * selectedId 高亮对应节点，支持从足迹地图跨视图定位。
 */
export const TrailGraph = forwardRef<ChartHandle, {
  graph: GraphView;
  selectedId: string | null;
  onSelect: (node: GraphNode) => void;
}>(function TrailGraph({ graph, selectedId, onSelect }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useImperativeHandle(ref, () => ({
    // roam 缩放/平移存在 series 的 zoom/center 上，回 1/null 即全貌
    fit: () => chartRef.current?.setOption({ series: [{ zoom: 1, center: null }] }),
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const p = readPalette(containerRef.current);

    const nodes = graph.nodes.map((n) => {
      if (n.kind === "hub") {
        return {
          id: n.id, name: n.label, symbol: "roundRect", symbolSize: [112, 34],
          itemStyle: { color: p.accentSoft, borderColor: p.accent, borderWidth: 1.3 },
          label: { show: true, fontSize: 12.5, fontWeight: 600 as const, color: p.accent },
        };
      }
      if (n.kind === "page") {
        return {
          id: n.id, name: trunc(n.label, 12), symbolSize: 19,
          itemStyle: { color: p.card, borderColor: p.ink, borderWidth: 1.5 },
          label: { show: true, position: "bottom" as const, fontSize: 10, color: p.label },
        };
      }
      if (n.kind === "memory") {
        return {
          id: n.id, name: trunc(n.label, 12), symbolSize: 9,
          itemStyle: { color: p.muted }, label: { show: false },
        };
      }
      // speak：被拦截的置灰
      return {
        id: n.id, name: trunc(n.label, 12), symbol: STAR, symbolSize: n.gated ? 20 : 26,
        itemStyle: n.gated
          ? { color: p.muted }
          : { color: p.accent, shadowBlur: 12, shadowColor: "rgba(247,213,29,.5)" },
        label: { show: false },
      };
    });

    chart.setOption({
      tooltip: {
        formatter: (params: unknown) => {
          const pr = params as { dataType?: string; data?: { label?: string; source?: string } };
          if (pr.dataType === "edge") return pr.data?.label ?? "";
          const node = graph.nodes.find((n) => n.id === (pr.data as { id?: string })?.id);
          return node?.label ?? "";
        },
      },
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        data: nodes,
        links: graph.edges.map((e) => ({
          source: e.source,
          target: e.target,
          label: e.label,
          lineStyle: e.kind === "mentioned" ? { type: "dashed" as const, color: p.accent } : undefined,
        })),
        force: { repulsion: 260, edgeLength: [60, 150], gravity: 0.08, friction: 0.25 },
        emphasis: { focus: "adjacency", lineStyle: { width: 2.5 } },
        // 邻接聚焦时其余节点保持可读（默认 blur 压得近乎不可见，图看着像空了）
        blur: { itemStyle: { opacity: 0.35 }, lineStyle: { opacity: 0.2 } },
        lineStyle: { color: p.line, width: 1.2 },
      }],
    });

    chart.on("click", (params) => {
      const id = (params.data as { id?: string } | undefined)?.id;
      const node = graph.nodes.find((n) => n.id === id);
      if (node) selectRef.current(node);
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [graph]);

  // 跨视图定位：高亮 + 顶出 tooltip（adjacency emphasis 连带邻居）
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !selectedId) return;
    const dataIndex = graph.nodes.findIndex((n) => n.id === selectedId);
    if (dataIndex < 0) return;
    chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex });
    chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex });
    return () => chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
  }, [selectedId, graph]);

  return <div ref={containerRef} className="trail-ecbox" />;
});
