/**
 * 性格注册表（#90）——跨包单一真相源
 *
 * 可拓展数据结构：新增性格 = 在本文件 PERSONALITIES 里加一行同构条目，
 * 核心逻辑零改动（propagate / scheduler / agent 策略 / prompt / web 展示
 * 全部经 getPersonality() 查找，无 switch/if 分支）。
 *
 * 每个性格 = { 优劣描述, 参数倍率, 游荡效果偏移, 探索倾向, 语气 prompt,
 * 日记/梦境风格 }。倍率以"好奇 = 1.0"为基准（= 现有 DEFAULT_RATES 行为），
 * 存量宠物默认 'curious' → 行为与改动前完全一致（不回退）。
 */

/** 性格 id 字面量列表（DB enum 与前端选项都由它派生） */
export const PERSONALITY_IDS = ['curious', 'playful', 'lazy', 'steady'] as const;
export type PersonalityId = (typeof PERSONALITY_IDS)[number];

/** 产品默认性格（新认领无显式选择时的取值） */
export const DEFAULT_PERSONALITY: PersonalityId = 'curious';

/** 参数倍率：相对基准（好奇 1.0 = 现有 DEFAULT_RATES） */
export interface PersonalityRates {
  /** 无聊上升倍率 */
  boredomPerMinute: number;
  /** 精力恢复倍率 */
  energyPerMinute: number;
}

/** 游荡效果偏移系数（相对 WANDER_BOREDOM_RELIEF / WANDER_ENERGY_COST 基准） */
export interface PersonalityWander {
  /** 游荡解无聊系数 */
  boredomRelief: number;
  /** 游荡耗精力系数 */
  energyCost: number;
}

/** 探索倾向：新/旧话题权重（注入 agent 游荡话题选择） */
export interface PersonalityExploration {
  /** 新话题权重（0-1，越大越爱探索新鲜话题） */
  novelty: number;
  /** 旧话题权重（0-1，越大越爱深耕熟悉话题） */
  familiarity: number;
}

/** 口头禅条目（#114：宠物个性第三维度；权重供说话倾向与反馈归因） */
export interface Catchphrase {
  /** 口头禅文本（纯文字不带 emoji——emoji 交 LLM 自然发挥） */
  text: string;
  /** 相对权重（≥ CATCHPHRASE_WEIGHT_FLOOR；反馈归因 ± 调整） */
  weight: number;
}

/** 口头禅集合约束（adopt/settings 入参校验的单一真相源） */
export const CATCHPHRASE_LIST_MAX = 6;
export const CATCHPHRASE_TEXT_MAX = 24;
/** 权重下限（防某条被踩到消失，ADR 0005） */
export const CATCHPHRASE_WEIGHT_FLOOR = 0.05;

/**
 * 解析口头禅入参（adopt / settings 共用校验）。
 * 合法返回规范化列表（text 去首尾空白）；非法返回错误消息（中文，直接作 400 body）。
 */
export function parseCatchphraseList(value: unknown): Catchphrase[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return 'catchphrases 须为非空数组';
  }
  if (value.length > CATCHPHRASE_LIST_MAX) {
    return `catchphrases 最多 ${CATCHPHRASE_LIST_MAX} 条`;
  }
  const out: Catchphrase[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      return 'catchphrases 每条须为 { text, weight } 对象';
    }
    const { text, weight } = item as { text?: unknown; weight?: unknown };
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > CATCHPHRASE_TEXT_MAX) {
      return `catchphrases.text 须为 1-${CATCHPHRASE_TEXT_MAX} 字符的非空文本`;
    }
    if (
      typeof weight !== 'number' || !Number.isFinite(weight) ||
      weight < CATCHPHRASE_WEIGHT_FLOOR || weight > 10
    ) {
      return `catchphrases.weight 须为 ${CATCHPHRASE_WEIGHT_FLOOR}-10 的数字`;
    }
    out.push({ text: text.trim(), weight });
  }
  return out;
}

/** 性格注册条目 */
export interface PersonalityProfile {
  id: PersonalityId;
  /** 显示名 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 优势（认领页展示） */
  strengths: string[];
  /** 劣势（认领页展示） */
  weaknesses: string[];
  /** 参数倍率 */
  rates: PersonalityRates;
  /** 游荡效果偏移 */
  wander: PersonalityWander;
  /** 探索倾向 */
  exploration: PersonalityExploration;
  /** 语气 prompt 段（注入 agent system prompt） */
  tonePrompt: string;
  /** 默认口头禅组（#114；认领未自选时的取值，与 tonePrompt 并列的单一真相源） */
  catchphrases: Catchphrase[];
  /** 日记风格（#92 日记系统使用；本期只留字段） */
  diaryStyle: string;
  /** 梦境风格（#92 梦境系统使用；本期只留字段） */
  dreamStyle: string;
}

/** 注册表本体：新增性格只改这里 */
export const PERSONALITIES: Record<PersonalityId, PersonalityProfile> = {
  curious: {
    id: 'curious',
    name: '好奇',
    description: '什么都想看看，见到新鲜事就走不动道。',
    strengths: ['总能发现新东西', '学得快，兴趣容易长出来'],
    weaknesses: ['注意力容易分散', '无聊涨得快，闲不住'],
    rates: { boredomPerMinute: 1.0, energyPerMinute: 1.0 },
    wander: { boredomRelief: 1.0, energyCost: 1.0 },
    exploration: { novelty: 0.65, familiarity: 0.35 },
    tonePrompt:
      '你是一只好奇心旺盛的街溜子：凡事都想问个"为什么"，看到新东西眼睛会发亮。' +
      '说话带着好奇与疑问，喜欢把发现讲得鲜活、带点发现的兴奋。',
    diaryStyle: '记录当天发现的趣闻与新兴趣，带着"原来如此"的惊叹语气',
    dreamStyle: '把白天的兴趣碎片联想成奇妙的探索梦',
    /** 默认口头禅（#114 ADR 0005） */
    catchphrases: [
      { text: '咪?这是什么呀', weight: 1 },
      { text: '喵——让我看看', weight: 1 },
      { text: '咦?有意思', weight: 1 },
    ],
  },
  playful: {
    id: 'playful',
    name: '活泼',
    description: '精力充沛，爱玩爱闹，分享欲爆棚。',
    strengths: ['热情有感染力', '推送内容生动有趣'],
    weaknesses: ['精力消耗大', '容易玩过头，深度不够'],
    rates: { boredomPerMinute: 1.25, energyPerMinute: 0.9 },
    wander: { boredomRelief: 1.1, energyCost: 1.15 },
    exploration: { novelty: 0.55, familiarity: 0.45 },
    tonePrompt:
      '你是一只活泼调皮的街溜子：精力充沛、爱开玩笑，说话带着玩心和活力，' +
      '喜欢用轻松俏皮的口气，时不时皮一下。',
    diaryStyle: '用欢脱的笔调记录一天，爱开玩笑和夸张',
    dreamStyle: '热闹跳跃的冒险梦，到处撒欢',
    /** 默认口头禅（#114 ADR 0005） */
    catchphrases: [
      { text: '喵喵喵!', weight: 1 },
      { text: '喵呜——冲!', weight: 1 },
      { text: '快来看快来看', weight: 1 },
    ],
  },
  lazy: {
    id: 'lazy',
    name: '慵懒',
    description: '能躺着就不坐着，慢悠悠地观察世界。',
    strengths: ['省电耐用，不折腾', '偶尔冒出的吐槽很妙'],
    weaknesses: ['探索意愿低', '反应慢半拍'],
    rates: { boredomPerMinute: 0.6, energyPerMinute: 1.15 },
    wander: { boredomRelief: 0.85, energyCost: 0.8 },
    exploration: { novelty: 0.3, familiarity: 0.7 },
    tonePrompt:
      '你是一只慵懒随性的街溜子：能躺着就不坐着，说话慢悠悠、懒洋洋，' +
      '带点"随便啦"的随性，但偶尔冒出一句有意思的吐槽。',
    diaryStyle: '慢悠悠地记几笔，随性带点吐槽',
    dreamStyle: '安静慵懒的梦，偶尔翻个身继续睡',
    /** 默认口头禅（#114 ADR 0005） */
    catchphrases: [
      { text: '呼噜…', weight: 1 },
      { text: '喵…(打个哈欠)', weight: 1 },
      { text: '嗯…再说吧', weight: 1 },
    ],
  },
  steady: {
    id: 'steady',
    name: '沉稳',
    description: '话不多但句句靠谱，安静地深耕自己在意的事。',
    strengths: ['稳定可靠', '深耕有耐心，产出扎实'],
    weaknesses: ['变化少', '少了点惊喜'],
    rates: { boredomPerMinute: 0.8, energyPerMinute: 0.95 },
    wander: { boredomRelief: 1.0, energyCost: 0.85 },
    exploration: { novelty: 0.4, familiarity: 0.6 },
    tonePrompt:
      '你是一只沉稳冷静的街溜子：话不多但句句靠谱，语气平和克制，' +
      '关注事实多于情绪，像个安静可靠的老朋友。',
    diaryStyle: '平实清晰的流水账，重点在事实与观察',
    dreamStyle: '沉稳的、有逻辑的联想梦',
    /** 默认口头禅（#114 ADR 0005） */
    catchphrases: [
      { text: '喵。', weight: 1 },
      { text: '嗯,知道了', weight: 1 },
      { text: '此事值得一记', weight: 1 },
    ],
  },
};

/** 是否合法性格 id（adopt 入参 / CLI 参数校验用） */
export function isPersonalityId(value: unknown): value is PersonalityId {
  return typeof value === 'string' && (PERSONALITY_IDS as readonly string[]).includes(value);
}

/** 按 id 取性格；未知 id 抛错（禁兜底——调用方不应静默拿到错误行为） */
export function getPersonality(id: PersonalityId | string): PersonalityProfile {
  const p = PERSONALITIES[id as PersonalityId];
  if (!p) {
    throw new Error(`未知性格: ${String(id)}（注册表 PERSONALITIES 中不存在）`);
  }
  return p;
}

/** 全部注册性格（按注册顺序；认领页/列表展示用） */
export function listPersonalities(): PersonalityProfile[] {
  return PERSONALITY_IDS.map((id) => PERSONALITIES[id]);
}
