/**
 * 宠物数值契约（ADR-0013：数值唯一真相源 = CP SQLite pets 表）——跨包单一真相源
 *
 * 交接 = 注入 + 写回：调度器拉起 worker 时注入最新数值（CP → agent CLI args），
 * worker 结束把新数值交回（stdout JSON），CP 落库。worker 不连数据库，
 * agent 保留无 CP 可嵌入性。
 */

/** 心情枚举（agent types.Mood = 此别名；HUD 标签原文呈现） */
export const PET_MOODS = ['curious', 'grumpy', 'playful', 'lazy', 'excited', 'emo'] as const;
export type PetMood = (typeof PET_MOODS)[number];

/** 宠物数值交接形状（energy/boredom/temper 0-100） */
export interface PetStats {
  energy: number;
  boredom: number;
  mood: PetMood;
  temper: number;
}

/** 是否合法心情枚举值 */
export function isPetMood(value: unknown): value is PetMood {
  return typeof value === 'string' && (PET_MOODS as readonly string[]).includes(value);
}

/**
 * 解析注入/回报的数值对象；形状非法返回 null。
 * 调用方必须显式失败（CLI exit 2 / 拒绝落库），禁静默兜底——
 * 数值是假的比失败更危险（#173/#213 的教训）。
 */
const inRange = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

export function parsePetStats(raw: unknown): PetStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    !inRange(r.energy) || !inRange(r.boredom) || !inRange(r.temper) ||
    !isPetMood(r.mood)
  ) {
    return null;
  }
  return { energy: r.energy, boredom: r.boredom, mood: r.mood, temper: r.temper };
}

/** worker 游荡结束回报的新数值（mood/temper 当前无更新点 #215，不随游荡变化） */
export interface WanderStatsReport {
  energy: number;
  boredom: number;
}

/** 反馈通道注入形状（心情增量计算只需 mood/temper——worker 不消耗精力/无聊） */
export interface FeedbackPetState {
  mood: PetMood;
  temper: number;
}

/**
 * 解析反馈通道的注入对象；形状非法返回 null（调用方显式 exit 2，禁兜底）。
 * 与 parsePetStats 分立：feedback/boost 只需要心情/脾气两字段，用全量校验器
 * 会把合法注入误判为非法（评审 #216 P0-1 的教训——跨进程形状要按通道定）。
 */
export function parseFeedbackPetState(raw: unknown): FeedbackPetState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isPetMood(r.mood) || !inRange(r.temper)) return null;
  return { mood: r.mood, temper: r.temper };
}
