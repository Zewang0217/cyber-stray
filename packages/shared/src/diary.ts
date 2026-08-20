/**
 * 日记风格选项（#92 日记系统）——跨包单一真相源
 *
 * 用户可配的日记文风：随意 / 认真 / 文艺（+ 默认"随性格"）。
 * 与 personality.ts 的 diaryStyle（性格自带的日记风格模板）正交：
 * - `diaryStyle: DiaryStyleChoice = 'personality'`（默认）→ 采用宠物性格的
 *   personality.diaryStyle 模板（#90 注册表字段）
 * - 显式选具体风格 → 覆盖性格模板（DIARY_STYLE_PROMPTS 的语气段）
 *
 * 可拓展：新增风格 = 在 DIARY_STYLES / DIARY_STYLE_PROMPTS 各加一行同构条目，
 * 核心逻辑零改动（diary-generator 经 resolveDiaryStylePrompt() 查找，无分支）。
 */

/** 日记风格 id 字面量列表（DB enum 与前端选项都由它派生） */
export const DIARY_STYLES = ['casual', 'careful', 'literary'] as const;
export type DiaryStyleId = (typeof DIARY_STYLES)[number];

/** 日记风格选择：具体风格 or 'personality'（跟随宠物性格模板，默认） */
export type DiaryStyleChoice = DiaryStyleId | 'personality';

/** 产品默认日记风格（用户未显式选择 = 跟随性格） */
export const DEFAULT_DIARY_STYLE: DiaryStyleChoice = 'personality';

/** 风格显示名（认领/设置页下拉选项） */
export const DIARY_STYLE_NAMES: Record<DiaryStyleId, string> = {
  casual: '随意',
  careful: '认真',
  literary: '文艺',
};

/** 各风格的语气 prompt 段（注入日记生成 prompt；'personality' 走性格模板） */
export const DIARY_STYLE_PROMPTS: Record<DiaryStyleId, string> = {
  casual: '用随意轻松的口吻记录这一天，像跟老朋友随口聊聊，不必太正式。',
  careful: '用认真条理的口吻记录这一天，结构清晰、重点突出，像一篇工整的日记。',
  literary: '用文艺优美的笔调记录这一天，善用意象与抒情，文字有质感。',
};

/** 是否合法具体日记风格 id */
export function isDiaryStyleId(value: unknown): value is DiaryStyleId {
  return typeof value === 'string' && (DIARY_STYLES as readonly string[]).includes(value);
}

/** 是否合法日记风格选择（具体风格或 'personality'） */
export function isDiaryStyleChoice(value: unknown): value is DiaryStyleChoice {
  return value === 'personality' || isDiaryStyleId(value);
}

/**
 * 解析最终生效的日记语气 prompt。
 *
 * styleChoice === 'personality' → 用性格注册表的 diaryStyle 模板；
 * 显式具体风格 → 用 DIARY_STYLE_PROMPTS 对应语气段。禁兜底：未知风格抛错。
 */
export function resolveDiaryStylePrompt(
  styleChoice: DiaryStyleChoice,
  personalityDiaryStyle: string,
): string {
  if (styleChoice === 'personality') {
    return personalityDiaryStyle;
  }
  if (isDiaryStyleId(styleChoice)) {
    return DIARY_STYLE_PROMPTS[styleChoice];
  }
  throw new Error(`未知日记风格: ${String(styleChoice)}（DIARY_STYLES 中不存在）`);
}
