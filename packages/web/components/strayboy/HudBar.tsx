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
  value: number;
  /** 高值告警（饥饿/无聊：越高越糟） */
  warnAt?: number;
  /** 低值告警（心情：低分才危险） */
  warnBelow?: number;
}) {
  const cells = Math.round((Math.min(100, Math.max(0, value)) / 100) * 10);
  const warn = warnAt !== undefined ? value >= warnAt
    : warnBelow !== undefined ? value <= warnBelow : false;
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[12px] text-[var(--paper)]">{label}</span>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-4 flex-1 gap-[2px] border-2 border-black bg-[var(--sky)] p-[2px]"
      >
        {Array.from({ length: 10 }, (_, i) => (
          <b
            key={i}
            className={`flex-1 ${i < cells ? (warn ? "sb-blink bg-[var(--bad)]" : "bg-[var(--ok)]") : "bg-[var(--window-off)]"}`}
          />
        ))}
      </div>
    </div>
  );
}
