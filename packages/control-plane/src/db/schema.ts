/**
 * 控制面数据模型（S3）
 *
 * SQLite + Drizzle ORM。schema 只用跨方言通用类型（text/integer/boolean），
 * 查询层可切 Postgres（client.ts 按 DATABASE_URL 换驱动）；**迁移**是方言
 * 专属产物，切库前需按 pg dialect 重新生成（见 db/migrate.ts 门控）。
 *
 * 覆盖：租户、宠物（含调度字段）、用户↔租户关系、账单（预留）、secrets（占位）。
 * 记忆仍在每租户 markdown 数据目录（不迁移——核心价值约束）。
 */

import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { PERSONALITY_IDS, DEFAULT_PERSONALITY } from '@cyber-stray/shared';
import { DIARY_STYLES, DEFAULT_DIARY_STYLE } from '@cyber-stray/shared/diary';

/** 时间戳：unix 毫秒（SQLite 无原生 datetime，integer 跨方言最稳） */
const now = () => Date.now();

export const tenants = sqliteTable('tenants', {
  /** 租户键 = 首登用户的 Casdoor sub（S2 决策；S3 后仍保持一对一） */
  id: text('id').primaryKey(),
  /** 显示名（默认 = 用户 display name） */
  name: text('name').notNull(),
  /** 套餐（S14：账号级——迁移自 pets.plan，1 租户 1 宠物下等价） */
  plan: text('plan', { enum: ['free', 'pro', 'byok'] }).notNull().default('free'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdate(() => Date.now()),
});

/** 全局管理员（S14 RBAC：身份在 Casdoor、权限在控制面） */
export const admins = sqliteTable('admins', {
  /** 管理员 Casdoor sub */
  sub: text('sub').primaryKey(),
  /** 授予者 sub（首个 bootstrap 来自 CP_ADMIN_SUBS env 时为 'env'） */
  grantedBy: text('granted_by').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
});

// ─── 用户 ↔ 租户关系 ────────────────────────────────────────────────────

export const userTenants = sqliteTable('user_tenants', {
  /** Casdoor sub */
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** 租户内角色（当前仅 owner；S9 反馈权限细分时扩展） */
  role: text('role', { enum: ['owner'] }).notNull().default('owner'),
  joinedAt: integer('joined_at').notNull().$defaultFn(now),
}, (t) => ({
  userTenantsPk: primaryKey({ columns: [t.userId, t.tenantId] }),
}));

// ─── 宠物（每租户可多只；当前单用户模式 1 租户 1 宠物） ─────────────────

export const pets = sqliteTable('pets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** active / paused（暂停时调度器跳过） */
  status: text('status', { enum: ['active', 'paused'] }).notNull().default('active'),
  /** 调度字段（S5 无聊/精力前推触发）：上次游荡时间，null = 从未跑过 */
  lastRunAt: integer('last_run_at'),
  cooldownUntil: integer('cooldown_until'),
  /** 上次顶话题时间（unix ms；S9 节流：free 30 天 / pro 1 天） */
  lastBoostAt: integer('last_boost_at'),
  boredom: integer('boredom').notNull().default(30),
  energy: integer('energy').notNull().default(80),
  /** 套餐（S11 门控：free/pro/byok） */
  plan: text('plan', { enum: ['free', 'pro', 'byok'] }).notNull().default('free'),
  /** 性格（认领时选择；好奇=基准参数，存量宠物默认 curious 行为不回退） */
  personality: text('personality', { enum: [...PERSONALITY_IDS] })
    .notNull()
    .default(DEFAULT_PERSONALITY),
  /** Pro 自定义推送时间窗（本地小时 0-23；null = 全天可推） */
  pushWindowStart: integer('push_window_start'),
  pushWindowEnd: integer('push_window_end'),
  /** 作息睡眠时间窗（#91，本地小时 0-23；null = 无作息，永不睡眠；与 pushWindow 同字段模式） */
  sleepStart: integer('sleep_start'),
  sleepEnd: integer('sleep_end'),
  /** 日记风格选择（#92；'personality' = 跟随性格，默认；或 casual/careful/literary） */
  diaryStyle: text('diary_style', { enum: ['personality', ...DIARY_STYLES] })
    .notNull()
    .default(DEFAULT_DIARY_STYLE),
  /** 是否推送每日日记（#92；Web Push 送达） */
  diaryPushEnabled: integer('diary_push_enabled', { mode: 'boolean' }).notNull().default(false),
  /** 上次生成日记的日期（YYYY-MM-DD；调度器按天去重，睡眠开始触发） */
  lastDiaryDate: text('last_diary_date'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdate(() => Date.now()),
}, (t) => ({
  /** 1 租户 1 宠物（adopt 原子幂等靠它；S9 多宠再放开） */
  petsTenantUnique: uniqueIndex('pets_tenant_unique').on(t.tenantId),
}));

// ─── 账单（预留：S11 双轨定价后启用） ──────────────────────────────────

export const billing = sqliteTable('billing', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  plan: text('plan', { enum: ['free', 'pro', 'byok'] }).notNull(),
  status: text('status', { enum: ['pending', 'paid', 'failed', 'cancelled'] })
    .notNull()
    .default('pending'),
  /** 金额（分） */
  amountCents: integer('amount_cents').notNull().default(0),
  currency: text('currency').notNull().default('CNY'),
  cycleStart: integer('cycle_start'),
  cycleEnd: integer('cycle_end'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
});

// ─── 每租户 secrets（占位：S4 信封加密后填充 encrypted blob + DEK keyId） ─

export const tenantSecrets = sqliteTable('tenant_secrets', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** 信封加密的 DEK 标识（S4 实现） */
  keyId: text('key_id'),
  /** DEK 加密后的 secrets 密文（S4 实现） */
  encrypted: text('encrypted'),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdate(() => Date.now()),
});

// ─── Web Push 订阅（S10，#77） ─────────────────────────────────────────

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** 浏览器推送端点（全局唯一；换租户重新订阅则覆盖归属） */
  endpoint: text('endpoint').notNull().unique(),
  /** 订阅密钥（加密握手材料，非机密凭证） */
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  /** 该设备上次已通知到的推送时间戳（unix ms；防重复通知） */
  lastNotifiedAt: integer('last_notified_at'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdate(() => Date.now()),
});

/** VAPID 密钥对（单例行 id=1；首用时生成，跨重启稳定） */
export const vapidKeys = sqliteTable('vapid_keys', {
  id: integer('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
});

// ─── 微信通道绑定（#97：每租户一个 iLink bot，扫码即用） ───────────────

/**
 * 每租户 iLink bot 身份与通道状态。bot_token 属登录凭证，不入本表——
 * 走 S4 信封加密（tenant_secrets，键 ilink_bot_token）。租户锚点 =
 * ilink_user_id（扫码主人的微信身份，pairing 白名单：仅此用户可互动/推送）。
 */
export const wechatBindings = sqliteTable('wechat_bindings', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** 扫码主人的微信身份（pairing 白名单；重扫后不变） */
  ilinkUserId: text('ilink_user_id').notNull(),
  /** 该租户的 bot 账号 ID（每次重扫生成新 bot，行内更新） */
  ilinkBotId: text('ilink_bot_id').notNull(),
  /** confirmed 返回的基座 URL（scaned_but_redirect 后可能 ≠ 默认基座） */
  baseUrl: text('base_url').notNull(),
  /** paired=已绑定未激活 / active=主人发过消息 / expired=24h 无交互 */
  status: text('status', { enum: ['paired', 'active', 'expired'] })
    .notNull()
    .default('paired'),
  boundAt: integer('bound_at').notNull().$defaultFn(now),
  /** 最近一次主人消息时间（unix ms；24h 保鲜判定） */
  lastInteractionAt: integer('last_interaction_at'),
  /** 最近一次通道错误（调试/监控用，不回显给客户端） */
  lastError: text('last_error'),
  /** getupdates 长轮询游标（重启恢复，防重收/漏收） */
  getUpdatesBuf: text('get_updates_buf'),
  /** 推送日账（原子 claim：pushes_date != 今天 时重置计数） */
  pushesDate: text('pushes_date'),
  pushesCount: integer('pushes_count').notNull().default(0),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdate(() => Date.now()),
});

// ─── 宠物 IP 自定义生成任务（#94：Pro/BYOK 专属异步管线） ───────────────

/**
 * 任务状态机（异步队列，进程内 PetGenProcessor tick 推进）：
 * spec_submitted → concept_generating → awaiting_confirmation →
 * generating_states → qc → done | failed。
 * - awaiting_confirmation 是用户锚点（ADR-0001 参考图锁角色）：确认 →
 *   generating_states；不满意改 spec → restart（回到 spec_submitted 重出概念图）。
 * - 生成素材落 data/tenants/<sub>/pet-assets/（manifest + 状态 PNG），
 *   任务工作目录 data/tenants/<sub>/pet-assets/tasks/<taskId>/ 存中间产物。
 * - 配额（建议 2 套/月，CP_PETGEN_MONTHLY_QUOTA 可配）：统计当前自然月
 *   状态=done 的任务数；失败任务不占配额。
 */
export const petGenTasks = sqliteTable('pet_gen_tasks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** 状态机状态（推进见 petgen/processor.ts） */
  status: text('status', {
    enum: [
      'spec_submitted',
      'concept_generating',
      'awaiting_confirmation',
      'generating_states',
      'qc',
      'done',
      'failed',
    ],
  })
    .notNull()
    .default('spec_submitted'),
  /** 用户 spec 纯文本（1-500 字符） */
  specText: text('spec_text').notNull(),
  /** 用户选项 JSON：{ palette?, size?, note? }（可选） */
  options: text('options'),
  /** 风格预设 id（PET_STYLE_PRESETS；缺省 chibi-kawaii） */
  stylePreset: text('style_preset'),
  /** 概念图路径（相对租户数据目录；awaiting_confirmation 起存在） */
  conceptPath: text('concept_path'),
  /** 当前生成策略（quad/nine/per；生成失败的批次按策略阶梯回退） */
  strategy: text('strategy', { enum: ['quad', 'nine', 'per'] })
    .notNull()
    .default('quad'),
  /** 当前策略连续批次失败计数（≥ maxBatchRetries 且非末级 → 升级策略） */
  batchRetries: integer('batch_retries').notNull().default(0),
  /** QC 重试轮数（≥ maxQcRetries 且仍有失败状态 → 整体失败，改 spec 重来） */
  qcRetries: integer('qc_retries').notNull().default(0),
  /** 最近一次 QC 结果 JSON：{ [state]: { pass, issues[] } }（失败反馈用） */
  qcResult: text('qc_result'),
  /** 待重生成状态 JSON（QC 失败后的单状态重试目标；空 = 全量） */
  pendingStates: text('pending_states'),
  /** 概念图生成尝试次数（restart 递增；诊断用） */
  conceptAttempts: integer('concept_attempts').notNull().default(0),
  /** 明确失败/停止原因（用户可见） */
  error: text('error'),
  /** 完成时间（unix ms；配额按自然月统计 done 任务的 completedAt） */
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdate(() => Date.now()),
}, (t) => ({
  /** 租户列表查询索引（GET /api/petgen/tasks + 配额统计）；非唯一——同租户多任务 */ 
  petGenTasksTenantIdx: index('pet_gen_tasks_tenant_idx').on(t.tenantId),
}));

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type VapidKey = typeof vapidKeys.$inferSelect;


export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
export type UserTenant = typeof userTenants.$inferSelect;
export type Pet = typeof pets.$inferSelect;
export type NewPet = typeof pets.$inferInsert;
export type Billing = typeof billing.$inferSelect;
export type TenantSecret = typeof tenantSecrets.$inferSelect;
export type WechatBinding = typeof wechatBindings.$inferSelect;
export type NewWechatBinding = typeof wechatBindings.$inferInsert;
export type PetGenTask = typeof petGenTasks.$inferSelect;
export type NewPetGenTask = typeof petGenTasks.$inferInsert;
