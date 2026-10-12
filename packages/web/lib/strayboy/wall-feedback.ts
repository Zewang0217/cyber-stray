/**
 * 墙上反馈的本地记忆：哪张明信片被赞/踩过（messageId → 类型）。
 *
 * 与 mail.ts 的 sb_wall_seen_ts 同模式：纯展示层缓存，不进 CP、不同步多端
 * （反馈本身已实时发往 /api/feedback，这里只让按钮在刷新后仍是已按状态）。
 * 损坏 JSON 直接丢弃重来（装饰态，不值得报错打断读墙）。
 */

const KEY = "sb_wall_feedback";
/** 只留最近 N 条，防长期使用无限膨胀 */
const MAX_ENTRIES = 500;

export type WallFeedbackMap = Record<string, "like" | "dislike">;

export function loadWallFeedback(): WallFeedbackMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const map: WallFeedbackMap = {};
    for (const [id, type] of Object.entries(parsed as Record<string, unknown>)) {
      if ((type === "like" || type === "dislike") && id) map[id] = type;
    }
    return map;
  } catch {
    return {};
  }
}

export function saveWallFeedback(map: WallFeedbackMap): void {
  if (typeof window === "undefined") return;
  const entries = Object.entries(map);
  const trimmed = entries.length > MAX_ENTRIES
    ? Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES))
    : map;
  window.localStorage.setItem(KEY, JSON.stringify(trimmed));
}
