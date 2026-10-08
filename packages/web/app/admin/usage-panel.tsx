"use client";

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
 * 换皮收口：全部走 design-v3 直角/14 色宇宙（旧体系 subtext/surface/圆角
 * 类名在深色面板上不可读，已清除）；账本故障租户显式标记不炸全表。
 */
export default function UsagePanel(): React.ReactElement {
  const { data, modelConfig, error, range, setRange, updateModel } = useUsage();

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      {/* 汇总卡片 + 模型下拉 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="mb-1 text-[12px] text-[var(--curb)]">总费用</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            ¥{summary ? summary.totalCost.toFixed(2) : "…"}
          </div>
        </div>
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="mb-1 text-[12px] text-[var(--curb)]">LLM token</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            {summary ? formatTokens(summary.totalLlmTokens) : "…"}
          </div>
        </div>
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="mb-1 text-[12px] text-[var(--curb)]">生图张数</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            {summary ? summary.totalImages : "…"}
          </div>
        </div>
        <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
          <div className="mb-1 text-[12px] text-[var(--curb)]">质检次数</div>
          <div className="font-vt323 text-[22px] text-[var(--paper)]">
            {summary ? summary.totalVisionQc : "…"}
          </div>
        </div>
      </div>

      {/* 筛选 + 模型切换（与维修口 tab 按钮同款像素按钮） */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`border-2 px-3 py-1.5 text-[13px] ${
                range === r.key
                  ? "border-[var(--act)] text-[var(--act)]"
                  : "border-[var(--curb)] text-[var(--paper)]"
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
            className="border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]"
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
      {summary && summary.ledgerErrors > 0 ? (
        <p className="border-2 border-[var(--bad)] px-3 py-2 text-[12px] leading-[1.7] text-[var(--bad)]">
          {summary.ledgerErrors} 个租户的用量账本有故障（记账闩锁 / 脏行 / 未知模型单价），
          其用量未计入汇总——见下表「账本故障」标记，需运维核对后恢复。
        </p>
      ) : null}

      {/* 每宠物表格 */}
      <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
        <h2 className="mb-4 font-vt323 text-[22px] text-[var(--paper)]">每宠物用量</h2>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b-2 border-[var(--curb)] text-left text-[var(--hi)]">
              <th className="py-2 pr-3">宠物</th>
              <th className="py-2 pr-3">权益</th>
              <th className="py-2 pr-3">LLM token</th>
              <th className="py-2 pr-3">生图</th>
              <th className="py-2 pr-3">质检</th>
              <th className="py-2 pr-3">费用</th>
              <th className="py-2 pr-3">今日预算（#265）</th>
              <th className="py-2">最近活跃</th>
            </tr>
          </thead>
          <tbody>
            {(data?.perTenant ?? []).map((t) => (
              <tr key={t.tenantId} className="border-b border-[var(--street)]">
                <td className="py-3 pr-3">
                  <div className="text-[var(--paper)]">{t.tenantName}</div>
                  <div className="font-vt323 text-[14px] text-[var(--curb)]">{t.tenantId.slice(0, 8)}</div>
                </td>
                {t.ledgerError ? (
                  <td colSpan={7} className="py-3 text-[13px] text-[var(--bad)]" title={t.ledgerError}>
                    账本故障：{t.ledgerError}
                  </td>
                ) : (
                  <>
                    <td className="py-3 pr-3 text-[var(--curb)]">{t.plan}</td>
                    <td className="py-3 pr-3 text-[var(--paper)]">{formatTokens(t.llmTokens)}</td>
                    <td className="py-3 pr-3 text-[var(--paper)]">{t.imageCount}</td>
                    <td className="py-3 pr-3 text-[var(--paper)]">{t.visionCount}</td>
                    <td className="py-3 pr-3 text-[var(--paper)]">¥{t.cost.toFixed(2)}</td>
                    <td className={`py-3 pr-3 font-vt323 text-[16px] ${t.llmBudgetYuan !== null && t.llmCostToday >= t.llmBudgetYuan ? "text-[var(--bad)]" : "text-[var(--curb)]"}`}>
                      {t.llmBudgetYuan === null
                        ? `¥${t.llmCostToday.toFixed(2)} / 不限`
                        : `¥${t.llmCostToday.toFixed(2)} / ¥${t.llmBudgetYuan.toFixed(2)}`}
                    </td>
                    <td className="py-3 text-[12px] text-[var(--curb)]">
                      {t.lastActive ? new Date(t.lastActive).toLocaleString("zh-CN") : "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {(data?.perTenant ?? []).length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-[var(--curb)]">
                  暂无用量数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* 最近明细 */}
      <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
        <h2 className="mb-4 font-vt323 text-[22px] text-[var(--paper)]">最近调用</h2>
        {(data?.recent ?? []).length === 0 ? (
          <p className="text-[12px] text-[var(--curb)]">暂无调用记录</p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {(data?.recent ?? []).map((r, i) => (
              <div
                key={`${r.timestamp}-${i}`}
                className="flex items-center justify-between gap-3 border-2 border-[var(--street)] bg-[var(--sky)] px-3 py-2 text-[13px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="whitespace-nowrap border border-[var(--hi)] px-1 text-[12px] text-[var(--hi)]">
                    {KIND_LABELS[r.kind] ?? r.kind}
                  </span>
                  <span className="truncate text-[var(--curb)]">{r.model}</span>
                  <span className="font-vt323 text-[14px] text-[var(--curb)]">{r.tenantId.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-4 whitespace-nowrap">
                  <span className="text-[12px] text-[var(--curb)]">
                    {r.kind === "llm"
                      ? `${formatTokens((r.inputTokens ?? 0) + (r.outputTokens ?? 0))} tok`
                      : `${r.images ?? 1} 张`}
                  </span>
                  <span className="w-16 text-right text-[var(--paper)]">¥{r.cost.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
