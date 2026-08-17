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

import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  /** Pro 自定义推送时间窗（本地小时 0-23；null = 全天可推） */
  pushWindowStart: integer('push_window_start'),
  pushWindowEnd: integer('push_window_end'),
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
