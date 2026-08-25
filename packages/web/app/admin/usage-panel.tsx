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
        <motion.div
          className="p-5 paper-card rounded-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="text-xs text-subtext mb-1">总费用</div>
          <div className="font-heading text-heading font-semibold text-text">
            ¥{summary ? summary.totalCost.toFixed(2) : "…"}
          </div>
        </motion.div>
        <motion.div
          className="p-5 paper-card rounded-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="text-xs text-subtext mb-1">LLM token</div>
          <div className="font-heading text-heading font-semibold text-text">
            {summary ? formatTokens(summary.totalLlmTokens) : "…"}
          </div>
        </motion.div>
        <motion.div
          className="p-5 paper-card rounded-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="text-xs text-subtext mb-1">生图张数</div>
          <div className="font-heading text-heading font-semibold text-text">
            {summary ? summary.totalImages : "…"}
          </div>
        </motion.div>
        <motion.div
          className="p-5 paper-card rounded-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="text-xs text-subtext mb-1">质检次数</div>
          <div className="font-heading text-heading font-semibold text-text">
            {summary ? summary.totalVisionQc : "…"}
          </div>
        </motion.div>
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
        <div className="flex items-center gap-2 text-small text-subtext">
          <span>生图模型</span>
          <select
            value={modelConfig?.imageModel ?? ""}
            onChange={(e) => void updateModel({ imageModel: e.target.value })}
            className="px-2 py-1.5 rounded-sm bg-surface text-small text-text border border-[var(--c-engraving-fine)]"
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

      {error ? <p className="text-small text-danger">{error}</p> : null}

      {/* 每宠物表格 */}
      <motion.div
        className="p-6 paper-card rounded-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="font-heading text-heading font-semibold text-text mb-4">每宠物用量</h2>
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
      </motion.div>

      {/* 最近明细 */}
      <motion.div
        className="p-6 paper-card rounded-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="font-heading text-heading font-semibold text-text mb-4">最近调用</h2>
        {(data?.recent ?? []).length === 0 ? (
          <p className="text-small text-subtext">暂无调用记录</p>
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
      </motion.div>
    </div>
  );
}
