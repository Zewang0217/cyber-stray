"use client";

import { usePetGen } from "@/hooks/usePetGen";
import { PET_STATE_IDS, type PetStateId } from "@cyber-stray/shared/pet";
import { BootFrame } from "@/components/strayboy/BootFrame";

/**
 * 改造屋（/pet/customize，#170 T2）：问卷纸 → 概念图相框确认 → 分段墨条进度 →
 * 素材网格预览。数据走 usePetGen（Pro/BYOK，403 = 无入口显式呈现）。
 * 字段与流程对齐 #169 混合管线结论（spec Decision 5/8）。
 */
export default function CustomizePage() {
  const { task, quota, loading, error, submit, confirm, restart } = usePetGen();

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
        <p className="mb-5 text-[13px] leading-[1.7] text-[var(--curb)]">
          Pro/BYOK 专属：描述你的专属街溜子，全自动生成完整像素素材。
          {quota ? `本月配额 ${quota.used}/${quota.limit} 套。` : ""}
        </p>

        {error && (
          <p className="mb-4 border-2 border-[var(--bad)] bg-[var(--panel)] p-2.5 text-[13px] text-[var(--bad)]">{error}</p>
        )}

        {/* 问卷纸：spec 输入 */}
        <section className="mb-5 border-2 border-[var(--ink)] bg-[var(--paper)] p-4 shadow-[5px_5px_0_#000]">
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
                {quota ? `剩余 ${quota.remaining} 套` : "风格固定：像素街区"}
              </span>
              <button
                type="submit"
                className="border-2 border-black bg-[var(--act)] px-4 py-2 text-[13px] text-[var(--sky)] shadow-[3px_3px_0_#000]"
              >
                生成概念图 ▶
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
            <p className="mt-2 font-vt323 text-[16px] text-[var(--curb)]">
              Loading = 猫形剪影原地小碎步（禁 spinner，components.md）
            </p>
          </section>
        )}

        {/* 素材网格预览（done） */}
        {task?.status === "done" && task.assetBase && (
          <section className="border-2 border-[var(--ink)] bg-[var(--paper)] p-4 shadow-[5px_5px_0_#000]">
            <h2 className="font-ps2p mb-3 text-xs text-[var(--ink)]">ASSETS · 素材网格</h2>
            <div className="grid grid-cols-3 gap-3">
              {PET_STATE_IDS.map((s: PetStateId) => (
                <figure key={s} className="border-2 border-[var(--curb)] bg-[var(--sky)] p-1.5 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${task.assetBase}/${s}.png`} alt={`${s} 状态素材`} className="pixelated w-full" />
                  <figcaption className="mt-1 text-[12px] text-[var(--ink)]">{s}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
