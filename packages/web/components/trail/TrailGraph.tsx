"use client";

import { useEffect, useRef } from "react";
import type { GraphNode, GraphView } from "@cyber-stray/shared/trail";
import { echarts, STAR, readPalette, trunc } from "./chart-setup";

/**
 * 关系图谱（F 视图）：主题枢纽 + 页面 + 记忆 + 叼回的力导向图。
 * 点击记忆/叼回节点经 onJump 回跳对应游荡（key = timestamp+tool，
 * 禁对象引用匹配：ECharts 回调里的 data 可能是内部克隆）。
 */
export function TrailGraph({ graph, onJump, onSelect }: {
  graph: GraphView;
  onJump: (key: string) => void;
  onSelect: (node: GraphNode) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const jumpRef = useRef(onJump);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    jumpRef.current = onJump;
    selectRef.current = onSelect;
  }, [onJump, onSelect]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const p = readPalette(ref.current);

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
        lineStyle: { color: p.line, width: 1.2 },
      }],
    });

    chart.on("click", (params) => {
      const id = (params.data as { id?: string } | undefined)?.id;
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) return;
      selectRef.current(node);
      if (node.key && (node.kind === "memory" || node.kind === "speak")) jumpRef.current(node.key);
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [graph]);

  return <div ref={ref} className="trail-ecbox" />;
}
