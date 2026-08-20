/**
 * 微信绑定存储 + 扫码即用 onboarding（#97）
 *
 * - 绑定行（wechat_bindings）：每租户一行的 bot 身份/通道状态/游标/推送日账。
 *   bot_token 属登录凭证 → S4 信封加密（tenant_secrets，键 ilink_bot_token）。
 * - 扫码即用（微信即账号）：确认后自动建租户 + 领养默认宠物 + 免费档。
 *   租户锚点 = ilink_user_id（主人微信身份，pairing 白名单）；重扫（重新
 *   激活）复用既有租户，仅更新 bot 身份。
 * - 推送限额：min(套餐每日上限, 8 条/天)——原子 claim（条件 UPDATE 关并发
 *   窗口）；超限由调用方降级其他已绑通道（飞书/TG/PWA 独立投递，天然降级）。
 */

import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { getDb, type ControlDb } from '../db/client.js';
import {
  pets,
  tenants,
  userTenants,
  wechatBindings,
  type NewWechatBinding,
  type WechatBinding,
} from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { planLimits } from '../plan/limits.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import type { IlinkQrStatusResp } from './types.js';

/** S4 secrets 存储名：ilink bot_token（微信登录凭证，等同密码级别） */
export const ILINK_BOT_TOKEN_SECRET = 'ilink_bot_token';

/** 微信通道每日推送上限（官方 10 条/24h 会话留 20% 余量） */
export const WECHAT_PUSH_DAILY_CAP = 8;

/** 24h 无交互 → 会话失效 */
export const WECHAT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 绑定状态 */
export type WechatBindingStatus = WechatBinding['status'];

/**
 * 租户键 = 主人微信身份的确定性派生（重扫映射同租户，符合 TENANT_ID_RE）。
 * ilink_user_id 形如 'hex…@im.wechat'（含 @/.，不能直接作 tenantId）。
 */
export function deriveTenantId(ilinkUserId: string): string {
  const hash = createHash('sha256').update(ilinkUserId).digest('hex').slice(0, 16);
  return `wx-${hash}`;
}

/** 是否已过期（无交互超 24h） */
export function isWechatSessionExpired(binding: WechatBinding, nowMs: number): boolean {
  return (
    binding.status === 'active' &&
    binding.lastInteractionAt !== null &&
    nowMs - binding.lastInteractionAt > WECHAT_SESSION_TTL_MS
  );
}

/** 微信通道日限额 = min(套餐每日上限, 8) */
export function wechatPushLimit(plan: string): number {
  return Math.min(planLimits(plan).pushesPerDay, WECHAT_PUSH_DAILY_CAP);
}

// ─── 存储读取 ───────────────────────────────────────────────────────────

export async function getBinding(
  db: ControlDb,
  tenantId: string,
): Promise<WechatBinding | undefined> {
  return db.select().from(wechatBindings).where(eq(wechatBindings.tenantId, tenantId)).get();
}

export async function getBindingByOwner(
  db: ControlDb,
  ilinkUserId: string,
): Promise<WechatBinding | undefined> {
  return db
    .select()
    .from(wechatBindings)
    .where(eq(wechatBindings.ilinkUserId, ilinkUserId))
    .get();
}

/** 更新绑定状态/游标等字段（不触碰推送日账，避免与 quota claim 并发互踩） */
export async function updateBinding(
  db: ControlDb,
  tenantId: string,
  patch: Partial<
    Pick<WechatBinding, 'status' | 'lastInteractionAt' | 'lastError' | 'getUpdatesBuf' | 'ilinkBotId' | 'ilinkUserId' | 'baseUrl'>
  >,
): Promise<void> {
  await db.update(wechatBindings).set(patch).where(eq(wechatBindings.tenantId, tenantId)).run();
}

/**
 * 原子 claim 一条推送额度（单条条件 UPDATE，防并发 dispatch 双计）：
 * - pushesDate != 今天 → 重置计数为 1（跨天首条）
 * - 否则 pushesCount + 1
 * WHERE 里的 (pushesDate != 今天 OR pushesCount < limit) 是额度守卫——
 * rowsAffected=0 = 今日额度已用尽（调用方降级其他已绑通道）。
 */
export async function claimPushQuota(
  db: ControlDb,
  tenantId: string,
  limit: number,
  today: string,
): Promise<boolean> {
  const result = await db
    .update(wechatBindings)
    .set({
      pushesDate: today,
      pushesCount: sql`CASE WHEN ${wechatBindings.pushesDate} != ${today} THEN 1 ELSE ${wechatBindings.pushesCount} + 1 END`,
    })
    .where(
      and(
        eq(wechatBindings.tenantId, tenantId),
        or(
          sql`${wechatBindings.pushesDate} != ${today}`,
          lt(wechatBindings.pushesCount, limit),
        ),
      ),
    )
    .run();
  return result.rowsAffected > 0;
}

// ─── 扫码即用 onboarding ────────────────────────────────────────────────

/** 领养默认宠物名（微信即账号路径；同 pets.ts adopt 的默认兴趣种子） */
export const DEFAULT_WECHAT_PET_NAME = '街溜子';

const DEFAULT_ADOPTION_INTERESTS = ['科技', 'AI', '互联网'];
const SEED_WEIGHT = 0.5;

export interface ProvisionResult {
  tenantId: string;
  /** 是否本次新建租户（false = 复用既有微信租户/重扫激活） */
  created: boolean;
  petName: string;
}

/**
 * 扫码确认后落库：建/复用租户 + 领养默认宠物 + 免费档 + 存 bot_token +
 * 写绑定行。幂等：重复 confirmed（并发/重试）经 onConflictDoNothing 短路。
 *
 * 微信身份 = 租户锚点：ilink_user_id 已存在绑定 → 复用其租户（重扫更新
 * 新 bot 身份）；否则 deriveTenantId 派生新租户键。
 */
export async function provisionWechatTenant(
  dataDir: string,
  resp: IlinkQrStatusResp,
  nowMs: number = Date.now(),
): Promise<ProvisionResult> {
  const ilinkUserId = resp.ilink_user_id;
  const botToken = resp.bot_token;
  const ilinkBotId = resp.ilink_bot_id;
  const baseUrl = resp.baseurl;
  if (!ilinkUserId || !botToken || !ilinkBotId || !baseUrl) {
    throw new Error('confirmed 响应缺少 ilink_user_id/bot_token/ilink_bot_id/baseurl 之一');
  }

  const db = await getDb(dataDir);
  const existing = await getBindingByOwner(db, ilinkUserId);
  const tenantId = existing?.tenantId ?? deriveTenantId(ilinkUserId);
  const created = !existing;

  // 租户数据目录（幂等；DB 失败留空目录可被下次绑定自愈）
  await mkdir(tenantDataDir(dataDir, tenantId), { recursive: true });

  await db.transaction(async (tx) => {
    if (created) {
      await tx
        .insert(tenants)
        .values({ id: tenantId, name: `微信主人 ${ilinkUserId.slice(0, 8)}`, plan: 'free' })
        .onConflictDoNothing()
        .run();
      await tx
        .insert(userTenants)
        .values({ userId: tenantId, tenantId, role: 'owner' })
        .onConflictDoNothing()
        .run();
    }
    // 绑定行：新建或重扫更新 bot 身份（幂等）
    const row: NewWechatBinding = {
      tenantId,
      ilinkUserId,
      ilinkBotId,
      baseUrl,
      status: 'paired',
      boundAt: nowMs,
      lastInteractionAt: null,
      getUpdatesBuf: null,
      pushesDate: null,
      pushesCount: 0,
    };
    await tx
      .insert(wechatBindings)
      .values(row)
      .onConflictDoUpdate({
        target: wechatBindings.tenantId,
        set: {
          ilinkBotId,
          baseUrl,
          status: 'paired',
          lastInteractionAt: null,
          lastError: null,
          // 重扫 = 新会话：清游标防旧 bot 历史重放
          getUpdatesBuf: null,
          pushesDate: null,
          pushesCount: 0,
        },
      })
      .run();
  });

  // 领养默认宠物（独立于租户事务：种子写文件 + pets 行；幂等）
  const petName = await adoptDefaultPet(dataDir, tenantId);
  // bot_token 加密落库（S4 信封；重扫覆盖为新 token）
  const store = await openTenantSecrets(dataDir, tenantId);
  await store.set(ILINK_BOT_TOKEN_SECRET, botToken);

  return { tenantId, created, petName };
}

/** 领养默认宠物（幂等：已有宠物则返回既有名，不覆盖兴趣种子） */
async function adoptDefaultPet(dataDir: string, tenantId: string): Promise<string> {
  const db = await getDb(dataDir);
  const existing = await db.select().from(pets).where(eq(pets.tenantId, tenantId)).get();
  if (existing) return existing.name;

  const seedPath = join(tenantDataDir(dataDir, tenantId), 'interests.json');
  try {
    await writeFile(
      seedPath,
      JSON.stringify(
        {
          version: 1,
          lastUpdated: new Date().toISOString(),
          nodes: DEFAULT_ADOPTION_INTERESTS.map((id) => ({
            id,
            weight: SEED_WEIGHT,
            source: 'default',
            createdAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            reinforceCount: 0,
          })),
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  const now = Date.now();
  await db
    .insert(pets)
    .values({
      id: randomUUID(),
      tenantId,
      name: DEFAULT_WECHAT_PET_NAME,
      status: 'active',
      lastRunAt: null,
      cooldownUntil: null,
      lastBoostAt: null,
      boredom: 75,
      energy: 80,
      pushWindowStart: null,
      pushWindowEnd: null,
    })
    .onConflictDoNothing({ target: pets.tenantId })
    .run();
  return DEFAULT_WECHAT_PET_NAME;
}

/** 读租户 bot_token（S4 解密）；未配置返回 null */
export async function readBotToken(dataDir: string, tenantId: string): Promise<string | null> {
  const store = await openTenantSecrets(dataDir, tenantId);
  return store.get(ILINK_BOT_TOKEN_SECRET);
}
