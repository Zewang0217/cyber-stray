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
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdate(() => Date.now()),
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
  /** 调度冷却到期（unix ms，S5 重试超限后冷却；null/过期 = 可调度） */
  cooldownUntil: integer('cooldown_until'),
  /** 无聊/精力（0-100）：编排状态在此层，记忆仍在 markdown */
  boredom: integer('boredom').notNull().default(30),
  energy: integer('energy').notNull().default(80),
  /** 套餐（S11 门控：free/pro/byok） */
  plan: text('plan', { enum: ['free', 'pro', 'byok'] }).notNull().default('free'),
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

// ─── 类型导出（查询层用） ──────────────────────────────────────────────

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type UserTenant = typeof userTenants.$inferSelect;
export type Pet = typeof pets.$inferSelect;
export type NewPet = typeof pets.$inferInsert;
export type Billing = typeof billing.$inferSelect;
export type TenantSecret = typeof tenantSecrets.$inferSelect;
