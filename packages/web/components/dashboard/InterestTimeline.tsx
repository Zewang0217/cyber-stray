"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { EvolutionSnapshot, FeedbackEvent, SnapshotNode } from "@/hooks/useEvolution";

/** 时间线画布(逻辑坐标,SVG viewBox) */
const W = 880;
const H = 340;
const PAD_L = 60;
const PAD_R = 20;
const PAD_T = 24;
const PAD_B = 64;

/** 默认只画 top-N(按最新权重),其余收进"查看全部"——20+ 条线在固定墨色梯度下必糊(#115) */
export const TOP_N = 8;

/** 同权重/近权重线用线型区分(铜版排线语言:实线/虚线/点线/点划线循环),叠加透明度梯度 */
const DASH_PATTERNS = ["", "6 4", "2 3", "9 4 2 4"];

/** 反馈事件带:近距事件聚成一面旗,避免多反馈标注互相重叠(#115 P2) */
const FLAG_CLUSTER_PX = 22;

/** 反馈类型 → 标注符号与墨色(铜版画语言内) */
const FEEDBACK_MARKS: Record<FeedbackEvent["type"], { symbol: string; color: string }> = {
  boost: { symbol: "▲", color: "var(--c-amber)" },
  like: { symbol: "♥", color: "var(--c-ink)" },
  dislike: { symbol: "▼", color: "var(--c-faded-ink)" },
};

/** 颜色:按兴趣 id 稳定分配墨色透明度梯度(Restrained——铜版排线密度语言,不用彩色) */
function colorFor(id: string): string {
  const opacities = [1, 0.78, 0.62, 0.5, 0.4];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return `oklch(0.28 0.02 75 / ${opacities[h % opacities.length]})`;
}

/** 采集一条兴趣的权重演化序列(按最新权重降序;快照缺节点记 0) */
export interface SeriesPoint {
  t: number;
  w: number;
}
export interface Series {
  id: string;
  color: string;
  points: SeriesPoint[];
  latest: number;
  source: string;
}

export function buildSeries(snapshots: EvolutionSnapshot[]): Series[] {
  const ids = new Set<string>();
  for (const s of snapshots) for (const n of s.nodes) ids.add(n.id);
  const series: Series[] = [];
  for (const id of ids) {
    const points: SeriesPoint[] = [];
    let latest = 0;
    let source = "default";
    for (const s of snapshots) {
      const node = s.nodes.find((n: SnapshotNode) => n.id === id);
      // 兴趣首次出现的快照才记点——之前快照缺节点不该画 0(否则动态 Y 轴
      // min 被幽灵零点拉到 0,动态范围退化为 [0,max],#115 目标失效)
      if (!node) continue;
      const t = new Date(s.timestamp).getTime();
      const w = node.weight;
      points.push({ t, w });
      latest = w;
      source = node.source;
    }
    series.push({ id, color: colorFor(id), points, latest, source });
  }
  return series.sort((a, b) => b.latest - a.latest);
}

/** Y 轴动态范围:按可见数据 min-max 留 12% 边,夹在 [0,1];退化(全等)时对称放大(#115 P0) */
export function yDomain(points: SeriesPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.w < min) min = p.w;
    if (p.w > max) max = p.w;
  }
  if (min === max) {
    min -= 0.1;
    max += 0.1;
  } else {
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
  }
  min = Math.max(0, min);
  max = Math.min(1, max);
  return min === max ? { min: Math.max(0, min - 0.1), max: Math.min(1, max + 0.1) } : { min, max };
}

export interface FeedbackCluster {
  t: number;
  counts: Record<FeedbackEvent["type"], number>;
}

/** 反馈事件按像素近距聚旗(≥3 条同近时间不重叠);范围外事件丢弃 */
export function clusterFeedbacks(
  feedbacks: FeedbackEvent[],
  t0: number,
  t1: number,
  plotWidth = W - PAD_L - PAD_R,
): FeedbackCluster[] {
  const span = Math.max(t1 - t0, 1);
  const events = feedbacks
    .map((f) => ({ t: new Date(f.timestamp).getTime(), type: f.type }))
    .filter((e) => e.t >= t0 && e.t <= t1)
    .sort((a, b) => a.t - b.t);
  const clusters: FeedbackCluster[] = [];
  for (const e of events) {
    const last = clusters[clusters.length - 1];
    if (last && ((e.t - last.t) / span) * plotWidth <= FLAG_CLUSTER_PX) {
      last.counts[e.type] += 1;
    } else {
      const counts = { like: 0, dislike: 0, boost: 0 };
      counts[e.type] = 1;
      clusters.push({ t: e.t, counts });
    }
  }
  return clusters;
}

/** 时间轴刻度(最多 5 个) */
function ticks(t0: number, t1: number): number[] {
  if (t0 === t1) return [t0];
  const n = 5;
  return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
}

export function formatTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 兴趣权重演化时间线(#115 重构):
 * - 默认 top-8 条线,"查看全部 N 条"展开;Y 轴动态范围
 * - 图例可 hover/点击高亮(变粗 + 尾部权重标签),其余线退淡
 * - 同权重线用线型(实/虚/点/点划)区分
 * - 反馈事件改独立事件带:近距事件聚旗,不再与折线/时间轴挤在一起
 */
export function InterestTimeline({
  snapshots,
  feedbacks,
}: {
  snapshots: EvolutionSnapshot[];
  feedbacks: FeedbackEvent[];
}): React.ReactElement {
  const series = useMemo(() => buildSeries(snapshots), [snapshots]);
  const [showAll, setShowAll] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const activeId = hovered ?? pinned;

  const { t0, t1 } = useMemo(() => {
    if (!snapshots.length) return { t0: 0, t1: 1 };
    const a = new Date(snapshots[0]!.timestamp).getTime();
    const b = new Date(snapshots[snapshots.length - 1]!.timestamp).getTime();
    return { t0: a, t1: b === a ? a + 1 : b };
  }, [snapshots]);
  const span = Math.max(t1 - t0, 1);

  const visible = showAll || series.length <= TOP_N ? series : series.slice(0, TOP_N);
  const domain = useMemo(() => yDomain(visible.flatMap((s) => s.points)), [visible]);

  const x = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R);
  const y = (w: number) => H - PAD_B - ((w - domain.min) / (domain.max - domain.min)) * (H - PAD_T - PAD_B);

  const active = activeId ? visible.find((s) => s.id === activeId) : undefined;
  const activeLabel = useMemo(() => {
    if (!active) return null;
    const last = active.points[active.points.length - 1]!;
    const anchorEnd = x(last.t) + 10 > W - PAD_R - 90;
    return {
      x: anchorEnd ? x(last.t) - 10 : x(last.t) + 10,
      y: y(last.w) - 8,
      anchor: anchorEnd ? ("end" as const) : ("start" as const),
      text: `${active.id} ${active.latest.toFixed(2)}`,
      color: active.color,
    };
    // x/y 闭包依赖 t0/span/domain,均为本组件内派生值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, t0, span, domain]);
  const feedbackClusters = useMemo(() => clusterFeedbacks(feedbacks, t0, t1), [feedbacks, t0, t1]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="兴趣权重演化时间线">
        {/* 网格 + Y 轴标签(动态范围) */}
        {[0, 1, 2, 3].map((i) => {
          const w = domain.min + ((domain.max - domain.min) * i) / 3;
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y(w)} x2={W - PAD_R} y2={y(w)} stroke="var(--c-engraving-fine)" strokeOpacity={0.35} />
              <text x={PAD_L - 8} y={y(w) + 4} textAnchor="end" fontSize={11} fill="var(--c-faded-ink)">
                {w.toFixed(2)}
              </text>
            </g>
          );
        })}
        {/* X 轴时间刻度 */}
        {ticks(t0, t1).map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={H - PAD_B} x2={x(t)} y2={H - PAD_B + 6} stroke="var(--c-engraving-fine)" />
            <text x={x(t)} y={H - PAD_B + 20} textAnchor="middle" fontSize={11} fill="var(--c-faded-ink)">
              {formatTime(t)}
            </text>
          </g>
        ))}
        {/* 反馈事件带:纵向小旗(近距聚旗),不再挤在轴线上 */}
        {feedbackClusters.map((c, i) => (
          <g key={i}>
            <line x1={x(c.t)} y1={H - PAD_B - 2} x2={x(c.t)} y2={H - PAD_B - 24} stroke="var(--c-engraving-fine)" strokeWidth={1} />
            <text x={x(c.t)} y={H - PAD_B - 28} textAnchor="middle" fontSize={10}>
              {(["like", "boost", "dislike"] as const).map((type) =>
                c.counts[type] > 0 ? (
                  <tspan key={type} fill={FEEDBACK_MARKS[type].color}>
                    {FEEDBACK_MARKS[type].symbol}
                    {c.counts[type] > 1 ? c.counts[type] : ""}
                  </tspan>
                ) : null,
              )}
            </text>
          </g>
        ))}
        {/* 兴趣权重线:active 高亮加粗,其余退淡;线型循环区分近权重线。
            入场用 mask 左→右揭示——绝不动 strokeDasharray/pathLength(#115
            线型区分对 framer 重渲染免疫,不再做一次性属性手术) */}
        {visible.map((s, rank) => {
          const isActive = s.id === activeId;
          const dimmed = activeId !== null && !isActive;
          const maskId = `timeline-mask-${rank}`;
          return (
            <g key={s.id}>
              <mask
                id={maskId}
                maskUnits="userSpaceOnUse"
                x={PAD_L}
                y={PAD_T}
                width={W - PAD_L - PAD_R}
                height={H - PAD_T - PAD_B}
              >
                <motion.rect
                  x={PAD_L}
                  y={PAD_T}
                  height={H - PAD_T - PAD_B}
                  fill="#fff"
                  initial={{ width: 0 }}
                  animate={{ width: W - PAD_L - PAD_R }}
                  transition={{
                    duration: 0.9,
                    ease: "easeOut",
                    delay: 0.15 + Math.min(rank * 0.07, 0.5),
                  }}
                />
              </mask>
              <polyline
                points={s.points.map((p) => `${x(p.t)},${y(p.w)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={isActive ? 3.5 : 2.5}
                strokeDasharray={DASH_PATTERNS[rank % DASH_PATTERNS.length]}
                strokeLinejoin="round"
                opacity={dimmed ? 0.18 : 1}
                mask={`url(#${maskId})`}
              />
            </g>
          );
        })}
        {/* 数据点:默认小点;active 系列加大 */}
        {visible.map((s) =>
          s.points.map((p, i) => (
            <circle
              key={`${s.id}-${i}`}
              cx={x(p.t)}
              cy={y(p.w)}
              r={s.id === activeId ? 3.5 : 2.5}
              fill={s.color}
              opacity={s.id === activeId ? 0.9 : 0.45}
            />
          )),
        )}
        {/* active 尾部标签:id + 最新权重 */}
        {activeLabel ? (
          <text x={activeLabel.x} y={activeLabel.y} textAnchor={activeLabel.anchor} fontSize={12} fontWeight={700} fill={activeLabel.color}>
            {activeLabel.text}
          </text>
        ) : null}
      </svg>

      {/* 图例:HTML flex-wrap,长 id 截断,不穿出图区;hover/点击高亮对应折线 */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-small text-subtext">兴趣图例(hover 或点击高亮)</span>
          {series.length > TOP_N ? (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="text-xs underline underline-offset-2 text-[var(--c-amber-ink)]"
            >
              {showAll ? `收起(只看前 ${TOP_N} 条)` : `查看全部 ${series.length} 条`}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {visible.map((s, rank) => (
            <button
              key={s.id}
              type="button"
              className={`flex items-center gap-1.5 text-xs ${s.id === activeId ? "font-semibold underline underline-offset-2" : ""} ${activeId !== null && s.id !== activeId ? "opacity-45" : ""}`}
              onMouseEnter={() => setHovered(s.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.id)}
              onBlur={() => setHovered(null)}
              onClick={() => setPinned(pinned === s.id ? null : s.id)}
              title={`${s.id} · 最新权重 ${s.latest.toFixed(2)}${s.source === "feedback" ? " · 由你顶起" : ""}`}
            >
              <svg width="20" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="20" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={DASH_PATTERNS[rank % DASH_PATTERNS.length] || undefined} />
              </svg>
              <span className="max-w-[180px] truncate">{s.id}</span>
              <span className="text-subtext font-mono">{s.latest.toFixed(2)}</span>
              {s.source === "feedback" ? <span className="text-[var(--c-amber-ink)]">顶</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
