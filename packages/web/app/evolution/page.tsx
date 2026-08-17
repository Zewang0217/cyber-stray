"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useEvolution, type EvolutionSnapshot, type SnapshotNode } from "@/hooks/useEvolution";

/** 时间线宽度 */
const W = 880;
const H = 340;
const PAD_L = 60;
const PAD_R = 20;
const PAD_T = 24;
const PAD_B = 46;

/** 颜色：按兴趣 id 稳定分配（哈希取色） */
function colorFor(id: string): string {
  const palette = ["#e06c3e", "#2f6fb0", "#2f9e5f", "#b7791f", "#8e44ad", "#c0392b", "#16a085", "#2980b9"];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return palette[h % palette.length]!;
}

/** 采集一条兴趣的权重演化序列（含 source 标注） */
interface SeriesPoint {
  t: number;
  w: number;
}
interface Series {
  id: string;
  color: string;
  points: SeriesPoint[];
  latest: number;
  source: string;
}

function buildSeries(snapshots: EvolutionSnapshot[]): Series[] {
  const ids = new Set<string>();
  for (const s of snapshots) for (const n of s.nodes) ids.add(n.id);
  const series: Series[] = [];
  for (const id of ids) {
    const points: SeriesPoint[] = [];
    let latest = 0;
    let source = "default";
    for (const s of snapshots) {
      const node = s.nodes.find((n: SnapshotNode) => n.id === id);
      const t = new Date(s.timestamp).getTime();
      const w = node?.weight ?? 0;
      points.push({ t, w });
      if (node) {
        latest = w;
        source = node.source;
      }
    }
    series.push({ id, color: colorFor(id), points, latest, source });
  }
  return series.sort((a, b) => b.latest - a.latest);
}

/** 时间轴刻度（最多 5 个） */
function ticks(t0: number, t1: number): number[] {
  if (t0 === t1) return [t0];
  const n = 5;
  return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
}

function formatTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 进化页（S13）：兴趣权重随游荡/反馈的时间线图 + 快照列表 + 回滚。
 */
export default function EvolutionPage(): React.ReactElement {
  const { data, error, rollback } = useEvolution();
  const [confirmHash, setConfirmHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const series = useMemo(() => (data ? buildSeries(data.snapshots) : []), [data]);

  const { t0, t1 } = useMemo(() => {
    if (!data?.snapshots.length) return { t0: 0, t1: 1 };
    const a = new Date(data.snapshots[0]!.timestamp).getTime();
    const b = new Date(data.snapshots[data.snapshots.length - 1]!.timestamp).getTime();
    return { t0: a, t1: b === a ? a + 1 : b };
  }, [data]);
  const span = Math.max(t1 - t0, 1);

  const x = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R);
  const y = (w: number) => H - PAD_B - w * (H - PAD_T - PAD_B);

  if (!data) {
    return (
      <div className="spacing-lg max-w-6xl mx-auto">
        <h1 className="font-heading text-heading font-bold text-text mb-2">进化</h1>
        <p className="text-body text-subtext">加载中…</p>
        {error ? <p className="text-small text-danger mt-2">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="spacing-lg max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <h1 className="font-heading text-heading font-bold text-text mb-1">进化</h1>
        <p className="text-body text-subtext mb-6">
          宠物兴趣随游荡与反馈的演化轨迹 · {data.summary.totalWanders} 次游荡 ·{" "}
          {data.summary.totalPushes} 次推送 · {data.snapshots.length} 个快照
        </p>
      </motion.div>

      {/* 时间线图 */}
      <motion.div
        className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {series.length === 0 ? (
          <p className="text-body text-subtext">还没有进化快照——宠物游荡并产生兴趣变化后这里会显示时间线。</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              {/* 网格 + Y 轴标签 */}
              {[0, 0.25, 0.5, 0.75, 1].map((w) => (
                <g key={w}>
                  <line x1={PAD_L} y1={y(w)} x2={W - PAD_R} y2={y(w)} stroke="rgba(255,255,255,0.08)" />
                  <text x={PAD_L - 8} y={y(w) + 4} textAnchor="end" fontSize={11} fill="#888">
                    {w.toFixed(2)}
                  </text>
                </g>
              ))}
              {/* X 轴时间刻度 */}
              {ticks(t0, t1).map((t) => (
                <g key={t}>
                  <line x1={x(t)} y1={H - PAD_B} x2={x(t)} y2={H - PAD_B + 6} stroke="rgba(255,255,255,0.3)" />
                  <text x={x(t)} y={H - PAD_B + 20} textAnchor="middle" fontSize={11} fill="#888">
                    {formatTime(t)}
                  </text>
                </g>
              ))}
              {/* 反馈事件标注（底部小标记） */}
              {data.feedbacks.map((f, i) => {
                const t = new Date(f.timestamp).getTime();
                if (t < t0 || t > t1) return null;
                const label = f.type === "boost" ? "▲顶" : f.type === "like" ? "♥赞" : "▼踩";
                const color = f.type === "boost" ? "#e06c3e" : f.type === "like" ? "#2f9e5f" : "#c0392b";
                return (
                  <g key={i}>
                    <text x={x(t)} y={H - PAD_B - 8} textAnchor="middle" fontSize={11} fill={color}>
                      {label}
                    </text>
                    <line x1={x(t)} y1={H - PAD_B - 12} x2={x(t)} y2={H - PAD_B} stroke={color} strokeWidth={1} strokeDasharray="2 2" />
                  </g>
                );
              })}
              {/* 兴趣权重线 */}
              {series.map((s) => (
                <g key={s.id}>
                  <polyline
                    points={s.points.map((p) => `${x(p.t)},${y(p.w)}`).join(" ")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                  />
                  {s.points.map((p, i) => (
                    <circle key={i} cx={x(p.t)} cy={y(p.w)} r={3} fill={s.color} opacity={0.7} />
                  ))}
                  {/* 图例 */}
                  <text
                    x={W - PAD_R}
                    y={PAD_T + 14 * series.indexOf(s)}
                    textAnchor="end"
                    fontSize={12}
                    fontWeight={700}
                    fill={s.color}
                  >
                    {s.id} {s.latest.toFixed(2)}
                    {s.source === "feedback" ? " · 由你顶起" : ""}
                  </text>
                </g>
              ))}
            </svg>
          </>
        )}
      </motion.div>

      {/* 快照列表 + 回滚 */}
      <motion.div
        className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="font-heading text-heading font-bold text-text mb-3">快照与回滚</h2>
        <p className="text-small text-subtext mb-4">
          回滚会把兴趣图谱还原到该时刻的权重（不删反馈/记忆记录）。可追溯、可撤销。
        </p>
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-subtext border-b border-white/10">
              <th className="py-2 pr-3">时间</th>
              <th className="py-2 pr-3">熵</th>
              <th className="py-2 pr-3">来源</th>
              <th className="py-2 pr-3">兴趣</th>
              <th className="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {[...data.snapshots].reverse().map((s) => (
              <tr key={s.hash} className="border-b border-white/5">
                <td className="py-2 pr-3 font-mono text-xs">{formatTime(new Date(s.timestamp).getTime())}</td>
                <td className="py-2 pr-3">{s.entropy.toFixed(2)}</td>
                <td className="py-2 pr-3">{s.source === "rollback" ? "回滚点" : "快照"}</td>
                <td className="py-2 pr-3 text-subtext">
                  {s.nodes.map((n) => `${n.id}:${n.weight.toFixed(2)}`).join(" · ")}
                </td>
                <td className="py-2">
                  {confirmHash === s.hash ? (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          const ok = await rollback(s.hash);
                          setBusy(false);
                          if (ok) setConfirmHash(null);
                        }}
                        className="px-3 py-1 rounded-xl text-xs font-semibold bg-danger/10 text-danger"
                      >
                        {busy ? "执行中…" : "确认回滚"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmHash(null)}
                        className="px-3 py-1 rounded-xl text-xs bg-surface text-subtext border border-white/10"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmHash(s.hash)}
                      className="px-3 py-1 rounded-xl text-xs bg-accent/10 text-accent"
                    >
                      回滚到此
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
      </motion.div>
    </div>
  );
}
