"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useEvolution } from "@/hooks/useEvolution";
import { InterestTimeline, formatTime } from "@/components/dashboard/InterestTimeline";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import {
  DialogRoot,
  DialogContent,
  DialogHeading,
  DialogDescription,
} from "@/components/ui/Dialog";

/** 快照表兴趣列:前 N 个 + 折叠计数,完整列表进 title 浮层(#115) */
const TABLE_INTEREST_N = 5;

/**
 * 进化页（S13）：兴趣权重随游荡/反馈的时间线图 + 快照列表 + 回滚。
 * 时间线图渲染(动态 Y 轴/top-N/图例交互/反馈事件带)见 InterestTimeline。
 * 回滚确认走统一 Dialog(图鉴登记卡式),不再在表格内联确认。
 */
export default function EvolutionPage(): React.ReactElement {
  const { data, error, rollback } = useEvolution();
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) {
    return (
      <div className="spacing-lg max-w-6xl mx-auto">
        <PageHeader kicker="Evolutio" title="进化" />
        <p className="text-body text-subtext">加载中…</p>
        {error ? <p className="text-small text-danger mt-2">{error}</p> : null}
      </div>
    );
  }

  const targetSnapshot = rollbackTarget
    ? data.snapshots.find((s) => s.hash === rollbackTarget)
    : null;

  return (
    <div className="spacing-lg max-w-6xl mx-auto">
      <PageHeader
        kicker="Evolutio"
        title="进化"
        subtitle={
          <>
            宠物兴趣随游荡与反馈的演化轨迹 · {data.summary.totalWanders} 次游荡 ·{" "}
            {data.summary.totalPushes} 次推送 · {data.snapshots.length} 个快照
          </>
        }
      />

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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRollbackTarget(s.hash)}
                      className="text-[var(--c-amber-ink)] border border-[var(--c-engraving-fine)] hover:border-[var(--c-amber)]"
                    >
                      回滚到此
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
      </motion.div>

      {/* 回滚确认(统一 Dialog;不可逆操作前明确确认) */}
      <DialogRoot
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeading kicker="Rollback · 回滚" title="确认回滚到此快照?" />
          <DialogDescription className="text-small text-subtext mb-4">
            会把兴趣图谱还原到
            {targetSnapshot
              ? ` ${formatTime(new Date(targetSnapshot.timestamp).getTime())} `
              : "该时刻"}
            的权重（不删反馈/记忆记录）。可追溯、可撤销。
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRollbackTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!rollbackTarget) return;
                setBusy(true);
                const ok = await rollback(rollbackTarget);
                setBusy(false);
                if (ok) setRollbackTarget(null);
              }}
            >
              {busy ? "执行中…" : "确认回滚"}
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
