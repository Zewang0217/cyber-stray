import { describe, it, expect } from 'vitest';
import {
  isValidQuotaValue,
  parseTenantQuotaOverrides,
  TENANT_QUOTA_KEYS,
} from './quota.js';

describe('isValidQuotaValue', () => {
  it('llmBudgetYuan：有限非负 ≤1000', () => {
    expect(isValidQuotaValue('llmBudgetYuan', 0)).toBe(true);
    expect(isValidQuotaValue('llmBudgetYuan', 2.5)).toBe(true);
    expect(isValidQuotaValue('llmBudgetYuan', 1001)).toBe(false);
    expect(isValidQuotaValue('llmBudgetYuan', -1)).toBe(false);
    expect(isValidQuotaValue('llmBudgetYuan', Number.NaN)).toBe(false);
  });

  it('petgenWeeklyLimit / pushesPerDay：整数且有上限', () => {
    expect(isValidQuotaValue('petgenWeeklyLimit', 3)).toBe(true);
    expect(isValidQuotaValue('petgenWeeklyLimit', 1.5)).toBe(false);
    expect(isValidQuotaValue('petgenWeeklyLimit', 31)).toBe(false);
    expect(isValidQuotaValue('pushesPerDay', 0)).toBe(true);
    expect(isValidQuotaValue('pushesPerDay', 200)).toBe(true);
    expect(isValidQuotaValue('pushesPerDay', 201)).toBe(false);
    expect(isValidQuotaValue('pushesPerDay', 2.5)).toBe(false);
  });
});

describe('parseTenantQuotaOverrides（存储层容错解析）', () => {
  it('合法 JSON → 覆盖对象；空对象 → null', () => {
    expect(parseTenantQuotaOverrides('{"llmBudgetYuan":5,"pushesPerDay":30}')).toEqual({
      llmBudgetYuan: 5,
      pushesPerDay: 30,
    });
    expect(parseTenantQuotaOverrides('{}')).toBeNull();
  });

  it('null / 空 / 非法 JSON / 非对象 → null', () => {
    expect(parseTenantQuotaOverrides(null)).toBeNull();
    expect(parseTenantQuotaOverrides('')).toBeNull();
    expect(parseTenantQuotaOverrides('not-json')).toBeNull();
    expect(parseTenantQuotaOverrides('[1,2]')).toBeNull();
    expect(parseTenantQuotaOverrides('42')).toBeNull();
  });

  it('含非法键值（越界 / 非数字）→ 整体拒绝为 null，不放大部分覆盖', () => {
    expect(parseTenantQuotaOverrides('{"llmBudgetYuan":9999}')).toBeNull();
    expect(parseTenantQuotaOverrides('{"petgenWeeklyLimit":"3"}')).toBeNull();
  });

  it('未知键被忽略（只认白名单键）', () => {
    expect(parseTenantQuotaOverrides('{"llmBudgetYuan":5,"hack":1}')).toEqual({ llmBudgetYuan: 5 });
    expect(TENANT_QUOTA_KEYS).toEqual(['llmBudgetYuan', 'petgenWeeklyLimit', 'pushesPerDay']);
  });
});
