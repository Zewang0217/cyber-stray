"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useEvolution } from "@/hooks/useEvolution";
import { InterestTimeline, formatTime } from "@/components/dashboard/InterestTimeline";

/** 快照表兴趣列:前 N 个 + 折叠计数,完整列表进 title 浮层(#115) */
const TABLE_INTEREST_N = 5;

/**
 * 进化页（S13）：兴趣权重随游荡/反馈的时间线图 + 快照列表 + 回滚。
 * 时间线图渲染(动态 Y 轴/top-N/图例交互/反馈事件带)见 InterestTimeline。
 */
export default function EvolutionPage(): React.ReactElement {
  const { data, error, rollback } = useEvolution();
  const [confirmHash, setConfirmHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) {
    return (
      <div className="spacing-lg max-w-6xl mx-auto">
        <h1 className="font-heading text-heading font-semibold text-text mb-2">进化</h1>
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
        <h1 className="font-heading text-heading font-semibold text-text mb-1">进化</h1>
        <p className="text-body text-subtext mb-6">
          宠物兴趣随游荡与反馈的演化轨迹 · {data.summary.totalWanders} 次游荡 ·{" "}
          {data.summary.totalPushes} 次推送 · {data.snapshots.length} 个快照
        </p>
      </motion.div>

      {/* 时间线图 */}
      <motion.div
        className="p-6 paper-card rounded-sm mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {data.snapshots.length === 0 ? (
          <p className="text-body text-subtext">还没有进化快照——宠物游荡并产生兴趣变化后这里会显示时间线。</p>
        ) : (
          <InterestTimeline snapshots={data.snapshots} feedbacks={data.feedbacks} />
        )}
      </motion.div>

      {/* 快照列表 + 回滚 */}
      <motion.div
        className="p-6 paper-card rounded-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="font-heading text-heading font-semibold text-text mb-3">快照与回滚</h2>
        <p className="text-small text-subtext mb-4">
          回滚会把兴趣图谱还原到该时刻的权重（不删反馈/记忆记录）。可追溯、可撤销。
        </p>
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-subtext border-b border-[var(--c-engraving-fine)]">
              <th className="py-2 pr-3">时间</th>
              <th className="py-2 pr-3">熵</th>
              <th className="py-2 pr-3">来源</th>
              <th className="py-2 pr-3">兴趣</th>
              <th className="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {[...data.snapshots].reverse().map((s) => {
              const shown = s.nodes.slice(0, TABLE_INTEREST_N);
              const rest = s.nodes.length - shown.length;
              const full = s.nodes.map((n) => `${n.id}:${n.weight.toFixed(2)}`).join(" · ");
              return (
                <tr key={s.hash} className="border-b border-[var(--c-engraving-fine)]/40">
                  <td className="py-2 pr-3 font-mono text-xs">{formatTime(new Date(s.timestamp).getTime())}</td>
                  <td className="py-2 pr-3">{s.entropy.toFixed(2)}</td>
                  <td className="py-2 pr-3">{s.source === "rollback" ? "回滚点" : "快照"}</td>
                  <td className="py-2 pr-3 text-subtext" title={full}>
                    {shown.map((n) => `${n.id}:${n.weight.toFixed(2)}`).join(" · ")}
                    {rest > 0 ? ` …+${rest}` : ""}
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
                          className="px-3 py-1 rounded-sm text-xs font-semibold bg-danger/10 text-danger"
                        >
                          {busy ? "执行中…" : "确认回滚"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmHash(null)}
                          className="px-3 py-1 rounded-sm text-xs bg-surface text-subtext border border-[var(--c-engraving-fine)]"
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmHash(s.hash)}
                        className="px-3 py-1 rounded-sm text-xs bg-[var(--c-amber)]/15 text-[var(--c-amber-ink)]"
                      >
                        回滚到此
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
      </motion.div>
    </div>
  );
}
