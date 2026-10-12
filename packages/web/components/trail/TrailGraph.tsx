"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { GraphNode, GraphView } from "@cyber-stray/shared/trail";
import { echarts, STAR, readPalette, trunc, type ChartHandle, type EChartsType } from "./chart-setup";

/** 节点数超过此值时不再常驻绘制页面标注（悬停 tooltip 仍可见全名） */
const GRAPH_LABEL_LIMIT = 200;

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
    // 大图关掉页面常驻标注：逐帧文字绘制是渲染大头，悬停 tooltip 仍可见全名
    const showPageLabels = graph.nodes.length <= GRAPH_LABEL_LIMIT;
    // tooltip/click 高频回调用 Map 反查（find 是每次鼠标移动 O(n)）
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

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
          label: { show: showPageLabels, position: "bottom" as const, fontSize: 10, color: p.label },
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
      // force 布局收敛期逐帧重摆节点，再叠加过渡插值只会更卡（官方 webkit-dep 同款关法）
      animation: false,
      tooltip: {
        formatter: (params: unknown) => {
          const pr = params as { dataType?: string; data?: { label?: string; source?: string } };
          if (pr.dataType === "edge") return pr.data?.label ?? "";
          return nodesById.get((pr.data as { id?: string })?.id ?? "")?.label ?? "";
        },
      },
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        // roam 响应区默认取数据包围盒并随 roam 变换缩放（View.containPoint），平移/缩小后画布边缘成死区；
        // 'global' 固定为整块画布（tree/sankey/treemap 的默认值，graph 缺省）
        roamTrigger: "global",
        draggable: true,
        data: nodes,
        links: graph.edges.map((e) => ({
          source: e.source,
          target: e.target,
          label: e.label,
          lineStyle: e.kind === "mentioned" ? { type: "dashed" as const, color: p.accent } : undefined,
        })),
        // circular 初始分布比随机散点收敛快得多（斥力迭代次数直接减半）
        force: { initLayout: "circular", repulsion: 260, edgeLength: [60, 150], gravity: 0.08, friction: 0.25 },
        emphasis: { focus: "adjacency", lineStyle: { width: 2.5 } },
        // 邻接聚焦时其余节点保持可读（默认 blur 压得近乎不可见，图看着像空了）
        blur: { itemStyle: { opacity: 0.35 }, lineStyle: { opacity: 0.2 } },
        lineStyle: { color: p.line, width: 1.2 },
      }],
    });

    chart.on("click", (params) => {
      const node = nodesById.get((params.data as { id?: string } | undefined)?.id ?? "");
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
