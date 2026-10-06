/** 自定义宠物的可播放投影；消费方不再自行猜测 manifest 版本或状态字段。 */
import { z } from 'zod';
import { PET_SHEET_STATE_IDS, PET_STATE_IDS, type PetStateId, type PetStateSpec } from './pet';
import { parseSpriteContract, type SpriteContract } from './sprite';

const AssetStemSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const StateIdSchema = z.enum(PET_STATE_IDS);
const StateSchema = z.object({
  file: AssetStemSchema,
  frames: z.literal(1),
  dur: z.number().positive(),
  label: z.string().min(1),
});
const SpriteSchema = z.object({
  image: z.string().regex(/^[a-zA-Z0-9_-]+\.png$/),
  frame: z.object({ w: z.number().int().positive(), h: z.number().int().positive(), groundRow: z.number().int().nonnegative() }),
  animations: z.record(z.string(), z.object({
    from: z.number().int().nonnegative(), frames: z.number().int().positive(),
    duration: z.number().positive(), loop: z.boolean(),
  })),
  // 缺省 3 是旧 sheet manifest 的明文兼容契约；有字段但值非法必须报错。
  displayScale: z.number().int().min(1).max(3).optional(),
});
const ManifestSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), generatedAt: z.iso.datetime(), states: z.record(StateIdSchema, StateSchema), sprite: z.never().optional() }),
  z.object({ version: z.literal(2), generatedAt: z.iso.datetime(), sprite: SpriteSchema }),
]);

export type PetAppearance =
  | { kind: 'states'; generatedAt: string; states: Record<PetStateId, PetStateSpec> }
  | { kind: 'sprite'; generatedAt: string; contract: SpriteContract; scale: number };

/** 校验完整素材后投影为播放器输入。存在但损坏的自定义素材不得冒充无素材。 */
export function parsePetAppearance(raw: unknown): PetAppearance {
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.slice(0, 1).map((issue) => `（${issue.path.join('.') || 'manifest'}）：${issue.message}`).join('');
    throw new Error(`宠物素材契约错误${detail}`);
  }
  const manifest = result.data;
  if (manifest.version === 1) {
    return { kind: 'states', generatedAt: manifest.generatedAt, states: manifest.states };
  }
  const { sprite } = manifest;
  const missing = PET_SHEET_STATE_IDS.filter((state) => !Object.hasOwn(sprite.animations, state));
  if (missing.length) throw new Error(`宠物精灵图缺动画：${missing.join(', ')}`);
  if (sprite.frame.groundRow >= sprite.frame.h) throw new Error('宠物精灵图 groundRow 超出帧高');
  const contract = parseSpriteContract({
    contract: 'stray-boy.sprite.v2', image: sprite.image,
    frame: sprite.frame, animations: sprite.animations,
  });
  return { kind: 'sprite', generatedAt: manifest.generatedAt, contract, scale: sprite.displayScale ?? 3 };
}

/** 街角演出映射到素材状态；经典九态保留独立 eat/celebrate，sheet 延续既有映射。 */
export function petAnimationFor(kind: PetAppearance['kind'], animation: string): PetStateId {
  const state = animation === 'pat' || animation === 'pounce' ? 'joy' : animation;
  const parsed = StateIdSchema.parse(state);
  if (kind === 'sprite' && parsed === 'eat') return 'idle';
  if (kind === 'sprite' && parsed === 'celebrate') return 'joy';
  return parsed;
}
