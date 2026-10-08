"use client";

import Link from "next/link";
import { usePetGen } from "@/hooks/usePetGen";
import { PetAppearancePreview } from "@/components/strayboy/PetAppearancePreview";
import { BootFrame } from "@/components/strayboy/BootFrame";

/**
 * 改造屋（/pet/customize，#170 T2）：问卷纸 → 概念图相框确认 → 分段墨条进度 →
 * 素材网格预览。数据走 usePetGen（Pro/BYOK，403 = 无入口显式呈现）。
 * 字段与流程对齐 #169 混合管线结论（spec Decision 5/8）。
 */
export default function CustomizePage() {
  const { task, quota, loading, error, submit, confirm, restart, retryQc, refresh } = usePetGen();

  // 分段墨条进度：按任务状态映射阶段
  const stages: Array<{ label: string; on: boolean }> = [
    { label: "问卷", on: true },
    { label: "概念图", on: !!task && ["awaiting_confirmation", "generating_states", "qc", "done"].includes(task.status) },
    { label: "生成", on: !!task && ["generating_states", "qc", "done"].includes(task.status) },
    { label: "质检", on: !!task && ["qc", "done"].includes(task.status) },
    { label: "完成", on: task?.status === "done" },
  ];

  return (
    <div className="sb min-h-screen bg-[var(--sky)] p-4">
      <BootFrame />
      <div className="mx-auto max-w-2xl">
        <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">CUSTOMIZE · 改造屋</h1>
        <Link href="/" className="mb-3 inline-block text-[13px] text-[var(--hi)] underline">← 回到街角</Link>
        <p className="mb-5 text-[13px] leading-[1.7] text-[var(--curb)]">
          描述你的专属街溜子，生成完整像素素材。受邀内测用户均可使用，生成次数以当前额度为准。
          {quota?.unlimited ? "管理员不限生成次数。" : "每七天可成功生成一套外观，失败不扣次数。"}
          {quota?.resetAt ? `下次可用：${new Date(quota.resetAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）。` : ""}
        </p>

        <PetAppearancePreview refreshToken={task?.completedAt ?? 0} />

        {error && (
          <div className="mb-4 border-2 border-[var(--bad)] bg-[var(--panel)] p-2.5 text-[13px] text-[var(--bad)]">
            <p>{error}</p>
            <button type="button" className="mt-2 underline" onClick={() => void refresh()}>重新加载</button>
          </div>
        )}

        {/* failed：显式呈现失败原因 + 重试引导（禁静默） */}
        {task?.status === "failed" && (
          <section className="mb-5 border-2 border-[var(--bad)] bg-[var(--panel)] p-4">
            <h2 className="mb-1 text-[14px] text-[var(--bad)]">生成失败</h2>
            <p className="text-[13px] leading-[1.7] text-[var(--paper)]">{task.error ?? "未知原因"}</p>
            {task.canRetryQc && (
              <button type="button" disabled={loading} onClick={() => void retryQc(task.id)}
                className="mt-3 border-2 border-[var(--ink)] bg-[var(--ok)] px-4 py-2 text-[13px] text-[var(--ink)] disabled:opacity-40">
                {loading ? "提交中……" : "重试质检"}
              </button>
            )}
            <p className="mt-2 text-[12px] text-[var(--curb)]">
              {task.canRetryQc ? "可直接复检已有素材，无需重新生成；也可调整下面的描述重新提交。" : "调整下面的描述重新提交；配额未消耗。"}
            </p>
          </section>
        )}

        {/* 问卷纸：spec 输入（任务进行中隐藏防重复提交烧配额） */}
        <section
          className="mb-5 border-2 border-[var(--ink)] bg-[var(--paper)] p-4 shadow-[5px_5px_0_#000]"
          hidden={!!task && ["awaiting_confirmation", "generating_states", "qc"].includes(task.status)}
        >
          <h2 className="mb-2 text-[14px] text-[var(--ink)]">问卷纸 · 描述你的街溜子</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const text = String(fd.get("spec") ?? "").trim();
              if (text.length === 0) return;
              void submit({ specText: text, stylePreset: "pixel" });
            }}
          >
            <textarea
              name="spec"
              rows={4}
              required
              defaultValue={task?.specText ?? ""}
              placeholder="例：一只戴墨镜的橘猫，白天在写字楼之间游荡，爱吐槽独角兽新闻……"
              className="font-noto mb-3 w-full border-2 border-[var(--curb)] bg-[#FDFBF5] p-3 text-[14px] leading-[1.7] text-[var(--ink)]"
            />
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[var(--curb)]">
                {quota === null
                  ? "配额加载中……"
                  : quota.available
                    ? quota.unlimited ? "管理员不限次" : `当前可生成 ${quota.remaining} 套`
                    : "当前账号暂不支持自助生成，可使用平台预置形象"}
              </span>
              <button
                type="submit"
                disabled={loading || !quota?.available || (!quota.unlimited && quota.remaining === 0)}
                className="border-2 border-black bg-[var(--act)] px-4 py-2 text-[13px] text-[var(--sky)] shadow-[3px_3px_0_#000] disabled:opacity-40"
              >
                {loading ? "提交中……" : "生成概念图 ▶"}
              </button>
            </div>
          </form>
        </section>

        {/* 概念图相框确认（awaiting_confirmation） */}
        {task?.status === "awaiting_confirmation" && task.conceptUrl && (
          <section className="mb-5 border-2 border-[var(--ink)] bg-[var(--paper)] p-4 text-center shadow-[5px_5px_0_#000]">
            <h2 className="font-ps2p mb-3 text-xs text-[var(--ink)]">CONCEPT · 概念图确认</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={task.conceptUrl} alt="概念图" className="pixelated mx-auto w-56 border-2 border-[var(--ink)]" />
            <p className="mt-3 text-[13px] text-[var(--ink)]">满意这只街溜子吗？确认后开始生成素材。</p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => void confirm(task.id)}
                className="border-2 border-black bg-[var(--ok)] px-4 py-2 font-ps2p text-xs text-[var(--sky)]"
              >
                确认，开工
              </button>
              <button
                type="button"
                onClick={() => void restart(task.id, { specText: task.specText, stylePreset: "pixel" })}
                className="border-2 border-[var(--curb)] bg-[var(--panel)] px-4 py-2 text-[13px] text-[var(--paper)]"
              >
                改 spec 重出
              </button>
            </div>
          </section>
        )}

        {/* 分段墨条进度（generating/qc） */}
        {(task?.status === "generating_states" || task?.status === "qc") && (
          <section className="mb-5 border-2 border-[var(--ink)] bg-[var(--panel)] p-4">
            <h2 className="mb-3 text-[14px] text-[var(--paper)]">素材生成中……</h2>
            <div className="flex flex-col gap-1.5">
              {stages.map((st) => (
                <div key={st.label} className="flex items-center gap-2">
                  <span className="w-16 text-[12px] text-[var(--curb)]">{st.label}</span>
                  <div className="flex h-3 flex-1 gap-[2px] border-2 border-black bg-[var(--sky)] p-[2px]">
                    {Array.from({ length: 10 }, (_, i) => (
                      <b key={i} className={`flex-1 ${st.on ? "bg-[var(--ok)]" : "bg-[var(--window-off)]"}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="font-noto mt-2 text-[13px] leading-[1.7] text-[var(--curb)]">
              正在生成动作并核对形象，完成后会自动更新。
            </p>
          </section>
        )}

      </div>
    </div>
  );
}
