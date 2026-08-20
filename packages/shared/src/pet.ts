/**
 * 宠物素材契约（#94 自定义 IP 生成 / #95 消费）——跨包单一真相源
 *
 * 来源：ADR-0001（参考图锁角色 + 单图多状态 + 静态帧）与 spike 结论
 * （docs/spike-multi-state.md：四宫格 2x2×3 主路径、素材契约建议 §5）。
 *
 * - PET_STATES：9 状态注册表（帧数/时长/无障碍标签），内置素材（public/pet/）
 *   与自定义 IP 共用同一套状态名；自定义 IP 的 manifest 每状态 frames=1
 *   （单帧静态 + 播放器程序微动画），dur/label 沿用本注册表。
 * - PET_STYLE_PRESETS：概念图风格预设（web 表单选项 → CP prompt 构建器）。
 */

/** 宠物状态 id（素材名 = 状态名；播放器状态机与生成管线都由它派生） */
export const PET_STATE_IDS = [
  'idle',
  'walk',
  'joy',
  'eat',
  'sleep',
  'think',
  'celebrate',
  'grumpy',
  'welcome',
] as const;
export type PetStateId = (typeof PET_STATE_IDS)[number];

/** 单状态素材规格（自定义 IP manifest 的 states.<state> 形状，frames 固定 1） */
export interface PetStateSpec {
  /** 帧条文件名（不含扩展名） */
  file: string;
  /** 帧数（自定义 IP 生成管线产出单帧静态：frames=1） */
  frames: number;
  /** 一次完整循环时长（秒）；呼吸慢，动作快 */
  dur: number;
  /** 无障碍描述 */
  label: string;
}

/** 状态注册表：dur/label 供生成 manifest 与播放器共用 */
export const PET_STATES: Record<PetStateId, PetStateSpec> = {
  idle: { file: 'idle', frames: 3, dur: 1.6, label: '待机呼吸' },
  walk: { file: 'walk', frames: 3, dur: 0.8, label: '游荡' },
  joy: { file: 'joy', frames: 3, dur: 0.7, label: '开心' },
  eat: { file: 'eat', frames: 3, dur: 0.9, label: '进食' },
  sleep: { file: 'sleep', frames: 3, dur: 2.2, label: '休息' },
  think: { file: 'think', frames: 3, dur: 1.4, label: '思考' },
  celebrate: { file: 'celebrate', frames: 3, dur: 0.65, label: '庆祝' },
  grumpy: { file: 'grumpy', frames: 3, dur: 1.1, label: '不爽' },
  welcome: { file: 'welcome', frames: 3, dur: 0.8, label: '打招呼' },
};

/** 风格预设 id（web 表单选项 / CP prompt 构建器共用） */
export const PET_PRESET_IDS = [
  'chibi-kawaii',
  'chinese-ink',
  'pixel',
  '3d-render',
  'flat-sticker',
] as const;
export type PetPresetId = (typeof PET_PRESET_IDS)[number];

export interface PetStylePreset {
  id: PetPresetId;
  /** 显示名 */
  name: string;
  /** 一句话描述（表单下拉用） */
  description: string;
  /** 注入生图 prompt 的风格段 */
  promptFragment: string;
}

/** 默认风格预设（新提交无显式选择时的取值） */
export const DEFAULT_PET_PRESET: PetPresetId = 'chibi-kawaii';

/** 风格预设注册表 */
export const PET_STYLE_PRESETS: Record<PetPresetId, PetStylePreset> = {
  'chibi-kawaii': {
    id: 'chibi-kawaii',
    name: 'Q 版可爱',
    description: '圆润 Q 版 kawaii 游戏精灵，大眼小嘴，柔和粉彩',
    promptFragment:
      '圆润 Q 版 kawaii 游戏精灵风格,大眼小嘴,柔和粉彩配色,短小四肢,' +
      '可爱比例(头身比约 1:1.5),圆润轮廓',
  },
  'chinese-ink': {
    id: 'chinese-ink',
    name: '国风水墨',
    description: '写意水墨笔触，留白构图，墨色晕染',
    promptFragment:
      '国风水墨风格,写意笔触,留白构图,墨色晕染,淡彩点缀,画面清雅有韵味',
  },
  pixel: {
    id: 'pixel',
    name: '像素复古',
    description: '16-bit 复古像素游戏精灵，轮廓清晰，高对比配色',
    promptFragment:
      '复古像素风,16-bit 游戏精灵,轮廓清晰,高对比配色,像素点阵质感,细节简洁',
  },
  '3d-render': {
    id: '3d-render',
    name: '3D 卡通',
    description: '3D 卡通渲染，柔光材质，圆润立体造型',
    promptFragment:
      '3D 卡通渲染风格,柔光材质,圆润立体造型,温和光照,轻微景深,质感细腻',
  },
  'flat-sticker': {
    id: 'flat-sticker',
    name: '扁平贴纸',
    description: '扁平矢量贴纸风，简洁色块，微投影',
    promptFragment:
      '扁平贴纸风格,简洁矢量轮廓,大胆色块,微投影,边缘干净,适合做贴纸',
  },
};

/** 是否合法风格预设 id（spec 校验用） */
export function isPetPresetId(value: unknown): value is PetPresetId {
  return typeof value === 'string' && (PET_PRESET_IDS as readonly string[]).includes(value);
}

/** 全部风格预设（按注册顺序；表单选项用） */
export function listPetStylePresets(): PetStylePreset[] {
  return PET_PRESET_IDS.map((id) => PET_STYLE_PRESETS[id]);
}

/** 按 id 取状态规格；未知 id 抛错（禁兜底——调用方不应静默拿到错误素材契约） */
export function getPetStateSpec(state: PetStateId | string): PetStateSpec {
  const spec = PET_STATES[state as PetStateId];
  if (!spec) {
    throw new Error(`未知宠物状态: ${String(state)}（注册表 PET_STATES 中不存在）`);
  }
  return spec;
}
