"use client";

import { useAgentState } from "@/hooks/useAgentState";
import { usePets } from "@/hooks/usePets";

interface Badge {
  id: string;
  label: string;
  desc: string;
  earned: boolean;
  progress: string;
}

/** 计算成就（前端派生，spec Decision：无后端字段）。 */
function deriveBadges(state: { totalWanders: number; totalPushes: number; totalSteps: number } | null, nodes: number): Badge[] {
  const w = state?.totalWanders ?? 0;
  const p = state?.totalPushes ?? 0;
  const s = state?.totalSteps ?? 0;
  return [
    { id: "first", label: "初次出门", desc: "完成第一次游荡", earned: w >= 1, progress: `${Math.min(w, 1)}/1` },
    { id: "w100", label: "百战老猫", desc: "累计游荡 100 次", earned: w >= 100, progress: `${Math.min(w, 100)}/100` },
    { id: "p100", label: "邮票大亨", desc: "寄出 100 张明信片", earned: p >= 100, progress: `${Math.min(p, 100)}/100` },
    { id: "s500", label: "铁脚板", desc: "累计游荡 500 步", earned: s >= 500, progress: `${Math.min(s, 500)}/500` },
    { id: "dex10", label: "图鉴收藏家", desc: "图鉴收录 10 个话题", earned: nodes >= 10, progress: `${Math.min(nodes, 10)}/10` },
  ];
}

/**
 * 成就徽章墙（delight B11）：全部里程碑前端派生，无后端字段。
 * 挂在 START 菜单（/#195-#191 约定）。
 */
export default function AchievementsPage() {
  const { state } = useAgentState();
  const badges = deriveBadges(state, 0);
  const earnedCount = badges.filter((b) => b.earned).length;

  return (
    <div className="sb min-h-screen bg-[var(--panel)] p-4">
      <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">AWARDS · 成就墙</h1>
      <p className="mb-5 text-[13px] text-[var(--curb)]">
        已解锁 {earnedCount}/{badges.length} —— 全部由现有 API 数据派生，无后端改动
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {badges.map((b) => (
          <div
            key={b.id}
            className={`flex items-center gap-3 border-2 p-3 ${b.earned ? "border-[var(--hi)] bg-[var(--panel)]" : "border-[var(--street)] bg-[var(--sky)] opacity-60"}`}
          >
            <span aria-hidden className={`h-8 w-8 shrink-0 border-2 ${b.earned ? "border-[var(--hi)] bg-[var(--hi)]/20" : "border-[var(--street)]"}`} />
            <div>
              <p className={`text-[14px] ${b.earned ? "text-[var(--hi)]" : "text-[var(--curb)]"}`}>{b.label}</p>
              <p className="text-[12px] text-[var(--curb)]">{b.desc}</p>
              <p className="font-vt323 text-[16px] text-[var(--curb)]">{b.progress}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
