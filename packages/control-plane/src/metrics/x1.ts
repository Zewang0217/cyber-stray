/**
 * X1 信念判定（#272 拍板的可观测定义）
 *
 * 「宠物在云端活着、为我进化、它推的我会在」= 领养完成（D0）后 [D7, D14]
 * 前向窗内 ≥1 次回访（认证 session 活跃日）且注册起累计 ≥1 次反馈。
 * 打开天数等导出为观察项，不设门槛。
 *
 * 日期一律本地日期键（YYYY-MM-DD），与 activity/feedback 落盘同源；
 * 纯函数无 IO，判定与窗口切分在这里测透，CLI（x1-report.ts）只做读数。
 */

/** 前向窗起点：领养后第 7 天（D0 + 7） */
export const X1_WINDOW_START_OFFSET_DAYS = 7;
/** 前向窗终点（含）：领养后第 14 天（D0 + 14） */
export const X1_WINDOW_END_OFFSET_DAYS = 14;

export interface X1Input {
  /** D0 = 领养完成日（本地日期键 YYYY-MM-DD，取 pets.createdAt） */
  adoptedDay: string;
  /** 租户活跃日集合（已去重升序，来自 activity JSONL） */
  activityDays: string[];
  /** 注册起累计反馈条数（feedback.json 全量） */
  feedbackCount: number;
}

export interface X1Result {
  /** 是否信念成立 */
  x1: boolean;
  /** 前向窗 [start, end]（含两端，本地日期键） */
  windowStart: string;
  windowEnd: string;
  /** 窗内的回访日（便于报告展示「第几天回来的」） */
  revisitDaysInWindow: string[];
  /** 全期活跃日数（观察项） */
  totalActiveDays: number;
  feedbackCount: number;
}

/** 本地日期键加 N 天（YYYY-MM-DD → YYYY-MM-DD；用 UTC 算术避免 DST 歧义） */
export function addDays(day: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`非法日期键：${day}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 判定 X1（纯函数） */
export function computeX1(input: X1Input): X1Result {
  const windowStart = addDays(input.adoptedDay, X1_WINDOW_START_OFFSET_DAYS);
  const windowEnd = addDays(input.adoptedDay, X1_WINDOW_END_OFFSET_DAYS);
  const revisitDaysInWindow = input.activityDays.filter((d) => d >= windowStart && d <= windowEnd);
  const revisit = revisitDaysInWindow.length > 0;
  const feedback = input.feedbackCount >= 1;
  return {
    x1: revisit && feedback,
    windowStart,
    windowEnd,
    revisitDaysInWindow,
    totalActiveDays: input.activityDays.length,
    feedbackCount: input.feedbackCount,
  };
}
