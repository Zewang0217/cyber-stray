/**
 * 单价表测试（#130）—— costOf 折算
 *
 * 契约：LLM 按输入/输出拆分价；生图/质检按张；旧行（仅 tokens）按输入价粗估；
 * 未知模型/未知 kind = 0（不瞎估）。
 */

import { describe, it, expect } from 'vitest';
import { costOf } from './pricing.js';

describe('costOf', () => {
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

  it('未知模型 → 0（不瞎估）', () => {
    const row = {
      timestamp: '2026-08-25T00:00:00Z',
      tenantId: 't',
      kind: 'llm' as const,
      model: 'mystery-model',
      inputTokens: 100,
    };
    expect(costOf(row)).toBe(0);
  });
});
