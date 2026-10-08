/**
 * 租户级配额覆盖（管理面板运维调整；存储 = CP tenants.quota_overrides 的 JSON 文本）。
 * 键缺省 = 跟随套餐默认；数值 0 与各机制默认口径一致 = 不限。
 * 读方 ≥2（CP 调度 / petgen / admin API 与 web 表单），契约下沉 shared 单一拥有。
 */

export interface TenantQuotaOverrides {
  /** 每日 LLM 预算（¥/天；0 = 不限） */
  llmBudgetYuan?: number;
  /** petgen 滚动七天套数（0 = 不限） */
  petgenWeeklyLimit?: number;
  /** 每日推送上限（0 = 不再推送） */
  pushesPerDay?: number;
}

export type TenantQuotaKey = keyof TenantQuotaOverrides;

export const TENANT_QUOTA_KEYS: readonly TenantQuotaKey[] = [
  'llmBudgetYuan',
  'petgenWeeklyLimit',
  'pushesPerDay',
];

/** 数值边界：写入侧严格校验（读侧只认合法值，防脏数据放大配额） */
export function isValidQuotaValue(key: TenantQuotaKey, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  if (key === 'llmBudgetYuan') return value <= 1000;
  if (key === 'petgenWeeklyLimit') return Number.isInteger(value) && value <= 30;
  return Number.isInteger(value) && value <= 200; // pushesPerDay
}

/**
 * 存储层解析：null / 空 / 非法 JSON / 含非法键值 / 空对象 → null（按无覆盖处理）。
 * 写入只经 admin API 严格校验，出现脏数据即人工改库；读侧容错，不炸调度。
 */
export function parseTenantQuotaOverrides(stored: string | null | undefined): TenantQuotaOverrides | null {
  if (!stored) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result: TenantQuotaOverrides = {};
  const obj = raw as Record<string, unknown>;
  for (const key of TENANT_QUOTA_KEYS) {
    const value = obj[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !isValidQuotaValue(key, value)) return null;
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}
