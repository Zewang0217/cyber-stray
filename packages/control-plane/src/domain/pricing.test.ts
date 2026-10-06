/**
 * 单价表测试（#130）—— costOf 折算
 *
 * 契约：LLM 按输入/输出拆分价；生图/质检按张；旧行（仅 tokens）按输入价粗估；
 * 未知模型显式抛错；非法 kind 在共享用量入口被拒绝。
 */

import { describe, it, expect } from 'vitest';
import { costOf } from './pricing.js';
import { UsageEntrySchema } from '@cyber-stray/shared/usage';

describe('costOf', () => {
  const base = { timestamp: '2026-10-04T00:00:00Z', tenantId: 'tenant', kind: 'llm', model: 'deepseek-chat' };

  it.each(['deepseek-v4-flash', 'deepseek-flash'])('%s 的真实输入/输出拆分按人民币预算上界计入成本', (model) => {
    const row = UsageEntrySchema.parse({ ...base, model, inputTokens: 1_000_000, outputTokens: 500_000 });
    expect(costOf(row)).toBeCloseTo(6, 6); // 高峰未命中输入 ¥2 + 输出 ¥4
  });

  it.each([
    { tokens: 1000, inputTokens: 100 },
    { tokens: 1000, outputTokens: 900 },
    { inputTokens: 100 },
    { outputTokens: 900 },
    { tokens: 1000, inputTokens: 100, outputTokens: 800 },
    { tokens: 1000, inputTokens: 0, outputTokens: 0 },
  ])('不完整或总分不一致的计量不能进入成本计算：%j', (measurement) => {
    expect(() => costOf(UsageEntrySchema.parse({ ...base, ...measurement }))).toThrow('计量');
  });

  it('共享校验允许只有总量的旧记录，以及完整且一致的拆分计量', () => {
    expect(costOf(UsageEntrySchema.parse({ ...base, tokens: 1000 }))).toBeCloseTo(0.002);
    expect(costOf(UsageEntrySchema.parse({ ...base, inputTokens: 100, outputTokens: 900 }))).toBeCloseTo(0.0074);
    expect(costOf(UsageEntrySchema.parse({ ...base, tokens: 1000, inputTokens: 100, outputTokens: 900 }))).toBeCloseTo(0.0074);
  });
  it('LLM 按输入/输出拆分计价（DeepSeek：输入 ¥2/M 输出 ¥8/M）', () => {
    const row = {
      timestamp: '2026-08-25T00:00:00Z',
      tenantId: 't',
      kind: 'llm' as const,
      model: 'deepseek-chat',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    };
    expect(costOf(row)).toBeCloseTo(2 + 4, 6); // 2 + 4 = 6 元
  });

  it('旧行兼容：仅 tokens 按输入价粗估', () => {
    const row = {
      timestamp: '2026-08-25T00:00:00Z',
      tenantId: 't',
      kind: 'llm' as const,
      model: 'deepseek-chat',
      tokens: 1_000_000,
    };
    expect(costOf(row)).toBeCloseTo(2, 6);
  });

  it('生图按张（Seedream ¥0.4/张）', () => {
    const row = {
      timestamp: '2026-08-25T00:00:00Z',
      tenantId: 't',
      kind: 'image' as const,
      model: 'doubao-seedream-5-0-260128',
      images: 3,
    };
    expect(costOf(row)).toBeCloseTo(1.2, 6);
  });

  it('质检免费（glm-4v-flash ¥0）', () => {
    const row = {
      timestamp: '2026-08-25T00:00:00Z',
      tenantId: 't',
      kind: 'vision_qc' as const,
      model: 'glm-4v-flash',
      images: 1,
    };
    expect(costOf(row)).toBe(0);
  });

  it('默认质检模型 glm-4.5v 按次计价（¥0.02/次，不再落 ¥0 低估成本）', () => {
    const row = {
      timestamp: '2026-08-25T00:00:00Z',
      tenantId: 't',
      kind: 'vision_qc' as const,
      model: 'glm-4.5v',
      images: 7,
    };
    expect(costOf(row)).toBeCloseTo(0.14, 6);
  });

  it('未知模型必须显式失败，不能把未知成本当免费', () => {
    const row = {
      timestamp: '2026-08-25T00:00:00Z',
      tenantId: 't',
      kind: 'llm' as const,
      model: 'mystery-model',
      inputTokens: 100,
    };
    expect(() => costOf(row)).toThrow('未知模型单价');
  });
});
