"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  listPetStylePresets,
  PET_STATES,
  PET_STATE_IDS,
  type PetStateId,
} from "@cyber-stray/shared/pet";
import { usePetGen, type PetGenSpecInput, type PetGenTaskStatus } from "@/hooks/usePetGen";

const presetOptions = listPetStylePresets();

/** 进行中状态（轮询展示） */
const BUSY: PetGenTaskStatus[] = [
  "spec_submitted",
  "concept_generating",
  "generating_states",
  "qc",
];

function statusLabel(status: PetGenTaskStatus): string {
  switch (status) {
    case "spec_submitted":
    case "concept_generating":
      return "概念图生成中…";
    case "awaiting_confirmation":
      return "等待你确认概念图";
    case "generating_states":
      return "生成全套状态素材中…";
    case "qc":
      return "质检中…";
    case "done":
      return "已交付";
    case "failed":
      return "生成失败";
  }
}

/**
 * 宠物 IP 定制（#94，Pro/BYOK 专属）
 *
 * 流程：spec（纯文本 + 选项 + 风格预设）→ 概念图 → 确认/调整重来 →
 * 全自动生成全套状态素材（四宫格主路径 + 两层质检）→ 落盘租户私有目录。
 * 免费用户无入口：页面级门禁 + API 403 双保险。
 */
export default function PetCustomizePage(): React.ReactElement {
  const { task, quota, loading, error, submit, confirm, restart } = usePetGen();
  const [spec, setSpec] = useState<PetGenSpecInput>({
    specText: "",
    options: {},
    stylePreset: "chibi-kawaii",
  });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);

  // 免费用户无入口（quota.available=false → 平台预置 IP 系列）
  if (quota && !quota.available) {
    return (
      <div className="spacing-lg max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-heading text-hero font-semibold text-text" style={{ letterSpacing: "-0.04em" }}>
            宠物 IP 定制
          </h1>
          <p className="text-body text-subtext mt-1">
            自定义宠物形象是 Pro/BYOK 专属功能
          </p>
        </motion.div>
        <div className="p-6 paper-card rounded-sm mt-6">
          <p className="text-body text-text">
            升级到 Pro（或接入自己的 API Key）后，可以为你的街溜子生成专属形象：
            描述它的样子 → 确认概念图 → 自动生成 9 种状态的完整素材。
          </p>
          <p className="text-small text-subtext mt-3">
            免费用户使用平台预置 IP 系列（设置页可切换套餐）。
          </p>
        </div>
      </div>
    );
  }

  const isBusy = task !== null && BUSY.includes(task.status);
  const showConcept =
    task?.status === "awaiting_confirmation" ||
    task?.status === "generating_states" ||
    task?.status === "qc";
  const showForm = !task || editing;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (spec.specText.trim().length === 0) return;
    setSubmitting(true);
    try {
      if (task && (task.status === "awaiting_confirmation" || task.status === "failed") && editing) {
        const ok = await restart(task.id, spec);
        if (ok) setEditing(false);
      } else {
        const created = await submit(spec);
        if (created) setEditing(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="spacing-lg max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-heading text-hero font-semibold text-text" style={{ letterSpacing: "-0.04em" }}>
          宠物 IP 定制
        </h1>
        <p className="text-body text-subtext mt-1">
          描述你的专属街溜子 → 确认概念图 → 自动生成全套状态素材（Pro/BYOK 专属）
        </p>
      </motion.div>

      {quota ? (
        <p className="text-small text-subtext mt-2 font-mono">
          本月配额：已用 {quota.used} / {quota.limit} 套{quota.remaining > 0 ? `（剩余 ${quota.remaining}）` : "（已用完，下月重置）"}
        </p>
      ) : null}

      {error ? (
        <div className="p-4 paper-card rounded-sm mt-4 border border-danger/30">
          <p className="text-small text-danger">{error}</p>
        </div>
      ) : null}

      {/* 步骤 1：spec 表单（新任务 / 调整重来 / 失败重试） */}
      {showForm ? (
        <motion.form
          onSubmit={(e) => void handleSubmit(e)}
          className="p-6 paper-card rounded-sm mt-4 space-y-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div>
            <label htmlFor="specText" className="block text-small text-subtext mb-1">
              形象描述（必填，1-500 字）——物种、毛色、装饰、气质都行
            </label>
            <textarea
              id="specText"
              value={spec.specText}
              onChange={(e) => setSpec((s) => ({ ...s, specText: e.target.value }))}
              rows={4}
              maxLength={500}
              placeholder="例：一只戴红色围巾的橘猫，圆滚滚的，尾巴尖是白色的…"
              className="w-full px-3 py-2 rounded-sm bg-surface text-body text-text border border-[var(--c-engraving-fine)]"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="palette" className="block text-small text-subtext mb-1">
                主色调偏好（可选）
              </label>
              <input
                id="palette"
                value={spec.options?.palette ?? ""}
                onChange={(e) => setSpec((s) => ({ ...s, options: { ...s.options, palette: e.target.value } }))}
                maxLength={100}
                placeholder="例：橙色为主，肚皮米白"
                className="w-full px-3 py-2 rounded-sm bg-surface text-body text-text border border-[var(--c-engraving-fine)]"
              />
            </div>
            <div>
              <label htmlFor="size" className="block text-small text-subtext mb-1">
                体型偏好（可选）
              </label>
              <input
                id="size"
                value={spec.options?.size ?? ""}
                onChange={(e) => setSpec((s) => ({ ...s, options: { ...s.options, size: e.target.value } }))}
                maxLength={100}
                placeholder="例：圆润、短腿"
                className="w-full px-3 py-2 rounded-sm bg-surface text-body text-text border border-[var(--c-engraving-fine)]"
              />
            </div>
          </div>
          <div>
            <label htmlFor="stylePreset" className="block text-small text-subtext mb-1">
              风格预设（可选）
            </label>
            <select
              id="stylePreset"
              value={spec.stylePreset}
              onChange={(e) => setSpec((s) => ({ ...s, stylePreset: e.target.value as PetGenSpecInput["stylePreset"] }))}
              className="w-full px-3 py-2 rounded-sm bg-surface text-body text-text border border-[var(--c-engraving-fine)]"
            >
              {presetOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}——{p.description}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || loading || spec.specText.trim().length === 0}
              className="px-5 py-2.5 rounded-sm bg-accent text-base font-semibold disabled:opacity-50"
            >
              {task?.status === "failed" && editing
                ? "按新描述重新生成"
                : task?.status === "awaiting_confirmation" && editing
                  ? "生成新概念图"
                  : "生成概念图"}
            </button>
            {task ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSpec({
                    specText: task.specText,
                    options: task.options ?? {},
                    stylePreset: task.stylePreset,
                  });
                }}
                className="px-4 py-2.5 rounded-sm text-small text-subtext"
              >
                返回当前任务
              </button>
            ) : null}
          </div>
          <p className="text-small text-subtext">
            生成过程为异步队列：提交后自动出概念图，确认后才开始生成全套素材（含两层质检）。
          </p>
        </motion.form>
      ) : null}

      {/* 步骤 2：进行中 / 概念图确认 / 结果 */}
      {task && !showForm ? (
        <motion.div
          className="p-6 paper-card rounded-sm mt-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-heading font-semibold text-text">
              {statusLabel(task.status)}
            </h2>
            <span className="font-mono text-small text-subtext">
              {task.status === "done" && task.completedAt
                ? new Date(task.completedAt).toLocaleString()
                : `尝试 #${task.conceptAttempts}`}
            </span>
          </div>

          {/* 概念图 */}
          {showConcept && task.conceptUrl ? (
            <div className="mt-4 flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={task.conceptUrl}
                alt="概念图"
                className="w-56 h-56 object-contain bg-white rounded-sm border border-[var(--c-engraving-fine)]"
              />
              <p className="text-small text-subtext">这是你的角色锚点——后续所有状态都锁定它</p>
            </div>
          ) : null}

          {/* 等待确认：满意 / 调整 */}
          {task.status === "awaiting_confirmation" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void confirm(task.id)}
                className="px-5 py-2.5 rounded-sm bg-accent text-base font-semibold"
              >
                满意，生成全套素材
              </button>
              <button
                type="button"
                onClick={() => {
                  setSpec({ specText: task.specText, options: task.options ?? {}, stylePreset: task.stylePreset });
                  setEditing(true);
                }}
                className="px-4 py-2.5 rounded-sm text-small text-subtext border border-[var(--c-engraving-fine)]"
              >
                不满意，调整描述重来
              </button>
            </div>
          ) : null}

          {/* 生成/质检进行中 */}
          {isBusy ? (
            <p className="text-small text-subtext mt-4 animate-pulse">
              队列推进中（单状态失败会自动重试并降级策略，通常几分钟内完成）…
            </p>
          ) : null}

          {/* 失败：明确反馈 + 改 spec 重来 */}
          {task.status === "failed" ? (
            <div className="mt-4">
              <p className="text-small text-danger whitespace-pre-wrap">{task.error}</p>
              <button
                type="button"
                onClick={() => {
                  setSpec({ specText: task.specText, options: task.options ?? {}, stylePreset: task.stylePreset });
                  setEditing(true);
                }}
                className="mt-3 px-4 py-2.5 rounded-sm bg-accent text-base font-semibold"
              >
                调整描述，重新生成
              </button>
            </div>
          ) : null}

          {/* done：素材预览 */}
          {task.status === "done" && task.assetBase ? (
            <div className="mt-4">
              <p className="text-small text-success">全套素材已生成并落盘到你的私有目录</p>
              <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 gap-3">
                {PET_STATE_IDS.map((s: PetStateId) => (
                  <div key={s} className="flex flex-col items-center gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${task.assetBase}/${s}.png`}
                      alt={PET_STATES[s].label}
                      className="w-16 h-16 object-contain bg-white rounded-sm border border-[var(--c-engraving-fine)]"
                    />
                    <span className="text-small text-subtext">{PET_STATES[s].label}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSpec({ specText: "", options: {}, stylePreset: "chibi-kawaii" });
                  setEditing(true);
                }}
                className="mt-4 px-4 py-2.5 rounded-sm text-small text-subtext border border-[var(--c-engraving-fine)]"
              >
                再定制一套（消耗本月配额）
              </button>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  );
}
