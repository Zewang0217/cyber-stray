/**
 * 分段计量条（DESIGN.md §4-4）：10 格墨条（2px 墨描边 + 色块），禁连续进度条。
 * 色语义（§2 NES 纪律）：正常 = --ok；告警（值 ≥ warnAt）= --bad 闪烁。
 */
export function HudBar({
  label,
  value,
  warnAt,
  warnBelow,
}: {
  label: string;
  /** null = 后端未上报（state 缺失）→ 显未知态「--」，禁伪装健康兜底（#217） */
  value: number | null;
  /** 高值告警（无聊/脾气：越高越糟） */
  warnAt?: number;
  /** 低值告警（精力：低于阈值危险） */
  warnBelow?: number;
}) {
  const unknown = value === null;
  const cells = unknown ? 0 : Math.round((Math.min(100, Math.max(0, value)) / 100) * 10);
  const warn = !unknown && warnAt !== undefined ? value >= warnAt
    : !unknown && warnBelow !== undefined ? value <= warnBelow : false;
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[12px] text-[var(--paper)]">{label}</span>
      <div
        role="meter"
        aria-label={unknown ? `${label}（未知）` : label}
        aria-valuenow={unknown ? undefined : Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-4 flex-1 gap-[2px] border-2 border-black bg-[var(--sky)] p-[2px]"
      >
        {unknown ? (
          <span className="flex-1 text-center text-[10px] leading-[14px] text-[var(--curb)]">? ? ?</span>
        ) : (
          Array.from({ length: 10 }, (_, i) => (
            <b
              key={i}
              className={`flex-1 ${i < cells ? (warn ? "sb-blink bg-[var(--bad)]" : "bg-[var(--ok)]") : "bg-[var(--window-off)]"}`}
            />
          ))
        )}
      </div>
    </div>
  );
}
