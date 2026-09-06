/**
 * 墙上（明信片墙）纯逻辑：未读推导（timestamp+localStorage，spec Decision 6——
 * 无已读字段，多端不同步已接受）、邮票轮换、日期签格式化。
 */

const SEEN_KEY = "sb_wall_seen_ts";

export function getSeenTimestamp(): number {
  if (typeof window === "undefined") return Number.MAX_SAFE_INTEGER;
  const raw = window.localStorage.getItem(SEEN_KEY);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function markAllSeen(newestMs: number): void {
  if (typeof window === "undefined") return;
  const prev = getSeenTimestamp();
  if (newestMs > prev) window.localStorage.setItem(SEEN_KEY, String(newestMs));
}

export function isUnread(timestampIso: string, seenMs: number): boolean {
  return new Date(timestampIso).getTime() > seenMs;
}

/** 邮票 4 款轮换（components.md §明信片）：按 timestamp 确定性取款。 */
export const STAMPS = ["cat-paw", "perforation", "block", "moon"] as const;
export type StampKind = (typeof STAMPS)[number];

export function pickStamp(timestampIso: string): StampKind {
  let hash = 0;
  for (const ch of timestampIso) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return STAMPS[hash % STAMPS.length];
}

/** 左上 mono 竖排日期签：DAY N（领养日起）· HH:MM。 */
export function stampLabel(timestampIso: string, adoptedAt: number, now = new Date()): {
  day: number;
  hhmm: string;
} {
  const t = new Date(timestampIso);
  const day = adoptedAt ? Math.max(1, Math.floor((t.getTime() - adoptedAt) / 86_400_000) + 1) : 1;
  const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  void now;
  return { day, hhmm };
}
