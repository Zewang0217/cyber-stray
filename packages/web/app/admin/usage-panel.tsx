"use client";

import { motion } from "framer-motion";
import { formatTokens, useUsage, type UsageRange } from "@/hooks/useUsage";

const RANGES: Array<{ key: UsageRange; label: string }> = [
  { key: "all", label: "全部" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "month", label: "本月" },
];

const KIND_LABELS: Record<string, string> = {
  llm: "LLM",
  image: "生图",
  vision_qc: "质检",
};

/**
 * 用量成本面板（ADR-0007）：汇总卡片 + 每宠物表格 + 时间筛选 + 明细 +
 * 生图模型下拉（全局配置热更新，#131）。
 */
export default function UsagePanel(): React.ReactElement {
  const { data, modelConfig, error, range, setRange, updateModel } = useUsage();

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      {/* 汇总卡片 + 模型下拉 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="text-[12px] text-[var(--curb)] mb-1">总费用</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            ¥{summary ? summary.totalCost.toFixed(2) : "…"}
          </div>
        </div>
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="text-[12px] text-[var(--curb)] mb-1">LLM token</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            {summary ? formatTokens(summary.totalLlmTokens) : "…"}
          </div>
        </div>
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="text-[12px] text-[var(--curb)] mb-1">生图张数</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            {summary ? summary.totalImages : "…"}
          </div>
        </div>
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="text-[12px] text-[var(--curb)] mb-1">质检次数</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            {summary ? summary.totalVisionQc : "…"}
          </div>
        </div>
      </div>

      {/* 筛选 + 模型切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors ${
                range === r.key
                  ? "bg-accent text-base"
                  : "bg-surface text-subtext border border-[var(--c-engraving-fine)] hover:text-text"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[var(--curb)]">
          <span>生图模型</span>
          <select
            value={modelConfig?.imageModel ?? ""}
            onChange={(e) => void updateModel({ imageModel: e.target.value })}
            className="px-2 py-1.5 border-2 border-[var(--curb)] bg-[var(--sky)] text-[13px] text-[var(--paper)]"
          >
            {modelConfig
              ? [...modelConfig.candidates.image, modelConfig.imageModel]
                  .filter((m, i, arr) => arr.indexOf(m) === i)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
              : null}
          </select>
        </div>
      </div>

      {error ? <p className="text-[13px] text-[var(--bad)]">{error}</p> : null}

      {/* 每宠物表格 */}
      <div
        className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4"
      >
        <h2 className="font-vt323 text-[22px] text-[var(--paper)] mb-4">每宠物用量</h2>
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-subtext border-b border-[var(--c-engraving-fine)]">
              <th className="py-2 pr-3">宠物</th>
              <th className="py-2 pr-3">套餐</th>
              <th className="py-2 pr-3">LLM token</th>
              <th className="py-2 pr-3">生图</th>
              <th className="py-2 pr-3">质检</th>
              <th className="py-2 pr-3">费用</th>
              <th className="py-2">最近活跃</th>
            </tr>
          </thead>
          <tbody>
            {(data?.perTenant ?? []).map((t) => (
              <tr key={t.tenantId} className="border-b border-[var(--c-engraving-fine)]/40">
                <td className="py-3 pr-3">
                  <div className="font-medium">{t.tenantName}</div>
                  <div className="text-xs text-subtext font-mono">{t.tenantId.slice(0, 8)}</div>
                </td>
                <td className="py-3 pr-3 text-subtext">{t.plan}</td>
                <td className="py-3 pr-3">{formatTokens(t.llmTokens)}</td>
                <td className="py-3 pr-3">{t.imageCount}</td>
                <td className="py-3 pr-3">{t.visionCount}</td>
                <td className="py-3 pr-3 font-medium">¥{t.cost.toFixed(2)}</td>
                <td className="py-3 text-subtext text-xs">
                  {t.lastActive ? new Date(t.lastActive).toLocaleString("zh-CN") : "—"}
                </td>
              </tr>
            ))}
            {(data?.perTenant ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-subtext">
                  暂无用量数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* 最近明细 */}
      <div
        className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4"
      >
        <h2 className="font-vt323 text-[22px] text-[var(--paper)] mb-4">最近调用</h2>
        {(data?.recent ?? []).length === 0 ? (
          <p className="text-[12px] text-[var(--curb)]">暂无调用记录</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {(data?.recent ?? []).map((r, i) => (
              <div
                key={`${r.timestamp}-${i}`}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-sm bg-surface/60 border border-[var(--c-engraving-fine)]/40 text-small"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="px-2 py-0.5 rounded-sm bg-[var(--c-amber)]/10 text-[var(--c-amber-ink)] text-xs font-semibold whitespace-nowrap">
                    {KIND_LABELS[r.kind] ?? r.kind}
                  </span>
                  <span className="text-subtext truncate">{r.model}</span>
                  <span className="text-subtext font-mono text-xs">{r.tenantId.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-4 whitespace-nowrap">
                  <span className="text-subtext text-xs">
                    {r.kind === "llm"
                      ? `${formatTokens((r.inputTokens ?? 0) + (r.outputTokens ?? 0))} tok`
                      : `${r.images ?? 1} 张`}
                  </span>
                  <span className="font-medium w-16 text-right">¥{r.cost.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
