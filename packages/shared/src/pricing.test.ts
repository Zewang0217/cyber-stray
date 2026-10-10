import { describe, expect, it } from 'vitest';
import { requireModelPrice } from './pricing.js';

describe('DeepSeek Flash 显式预算价格', () => {
  it.each(['deepseek-v4-flash', 'deepseek-flash'])('%s 可用于 LLM 预检，未命中/命中/输出三档价', (model) => {
    expect(requireModelPrice(model, 'llm')).toEqual({ inputPerM: 2, inputCacheHitPerM: 0.04, outputPerM: 8 });
    expect(() => requireModelPrice(model, 'image')).toThrow('缺少有效的 image 单价');
    expect(() => requireModelPrice(model, 'vision_qc')).toThrow('缺少有效的 vision_qc 单价');
  });

  it('未知变体仍被拒绝，不能按前缀匹配成 Flash 价格', () => {
    expect(() => requireModelPrice('deepseek-v4-flash-unknown', 'llm')).toThrow('未知模型单价');
  });
});
