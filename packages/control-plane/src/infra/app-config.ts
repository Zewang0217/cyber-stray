/**
 * 全局模型配置（ADR-0007 决策 3）—— DB 存 + admin 热更新 + 内存缓存
 *
 * admin 面板改 → 写 app_config 表 → 刷新进程内缓存 → 下一次生图用新模型
 * （无重启）。CP 单进程，模块级缓存即进程内单例；defaults 来自 env（config.ts），
 * DB 缺省回退 env。
 *
 * 范围：CP 侧 petgen 生图/质检模型。agent worker（表情包）是短命进程，
 * 每次 spawn 读 env（MEME_IMAGE_MODEL/MEME_VL_MODEL）——不在本期热更新范围。
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { appConfig } from '../db/schema.js';

export interface ModelConfig {
  imageModel: string;
  visionModel: string;
}

/** 配置键 */
const KEY_IMAGE = 'imageModel';
const KEY_VISION = 'visionModel';

/** admin 面板推荐模型；新增 ID 必须先在 shared/pricing 登记成本。 */
export const MODEL_CANDIDATES: Record<'image' | 'vision', string[]> = {
  image: [
    'doubao-seedream-5-0-260128',
  ],
  vision: ['ecnu-plus', 'glm-4.5v', 'glm-4v-flash'],
};

/** 进程内缓存（null = 未加载；get 回退 defaults） */
let cached: ModelConfig | null = null;

/** 从 DB 读配置（缺省回退 defaults）；不查缓存 */
async function readFromDb(dataDir: string, defaults: ModelConfig): Promise<ModelConfig> {
  const db = await getDb(dataDir);
  const rows = await db.select().from(appConfig).all();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    imageModel: map.get(KEY_IMAGE) ?? defaults.imageModel,
    visionModel: map.get(KEY_VISION) ?? defaults.visionModel,
  };
}

/** 启动时加载（index.ts 调用）；成功即刷缓存 */
export async function refreshModelConfig(dataDir: string, defaults: ModelConfig): Promise<ModelConfig> {
  cached = await readFromDb(dataDir, defaults);
  return cached;
}

/** 同步读当前生效配置（processor 装配用；未加载回退 defaults——不应发生，index.ts 启动已 refresh） */
export function getModelConfig(defaults: ModelConfig): ModelConfig {
  return cached ?? defaults;
}

/** 写 DB + 刷缓存（admin PUT 调用）；返回新配置 */
export async function setModelConfig(dataDir: string, cfg: ModelConfig): Promise<ModelConfig> {
  const db = await getDb(dataDir);
  const now = Date.now();
  for (const [key, value] of [
    [KEY_IMAGE, cfg.imageModel],
    [KEY_VISION, cfg.visionModel],
  ] as const) {
    await db
      .insert(appConfig)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: appConfig.key,
        set: { value, updatedAt: now },
      })
      .run();
  }
  cached = { ...cfg };
  return cached;
}

/** 校验模型 ID（非空字符串 ≤100 字符）；非法返回错误消息 */
export function validateModelId(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return '模型 ID 不能为空';
  if (value.length > 100) return '模型 ID 过长（≤100 字符）';
  return null;
}
