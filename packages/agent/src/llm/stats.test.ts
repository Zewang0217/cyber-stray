/**
 * LLM 调用统计（按步累加）单元测试
 *
 * Wave 0 覆盖�?1-03 Task 1）：
 * - recordStep 累加：多次调�?�?getLLMStats().calls === 次数
 * - 聚合：totalMs / avgMs / totalTokens �?durationMs �?totalTokens 求和与均�?
 * - reset：resetLLMStats() 后归�?
 * - no-throw 自愈（Pitfall 1）：recordStep 收到 null/缺字段不抛错
 * - 空状态：�?recordStep �?getLLMStats() 返回全零
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { recordStep, getLLMStats, resetLLMStats, type StepRecord } from './stats.js';

describe('LLM stats', () => {
  beforeEach(() => {
    resetLLMStats();
  });

  test('recordStep 累加�? 次调用后 calls === 3', () => {
    recordStep({ stepNumber: 0, durationMs: 10 });
    recordStep({ stepNumber: 1, durationMs: 20 });
    recordStep({ stepNumber: 2, durationMs: 30 });

    expect(getLLMStats().calls).toBe(3);
  });

  test('聚合：totalMs / avgMs / totalTokens 按字段求和与均�?, () => {
    recordStep({ stepNumber: 0, totalTokens: 30, durationMs: 100 });
    recordStep({ stepNumber: 1, totalTokens: 50, durationMs: 200 });

    const stats = getLLMStats();
    expect(stats.calls).toBe(2);
    expect(stats.totalMs).toBe(300);
    expect(stats.avgMs).toBe(150);
    expect(stats.totalTokens).toBe(80);
  });

  test('reset：resetLLMStats() �?calls === 0 且聚合全�?, () => {
    recordStep({ stepNumber: 0, totalTokens: 30, durationMs: 100 });
    expect(getLLMStats().calls).toBe(1);

    resetLLMStats();

    const stats = getLLMStats();
    expect(stats.calls).toBe(0);
    expect(stats.totalMs).toBe(0);
    expect(stats.avgMs).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });

  test('no-throw 自愈（Pitfall 1）：recordStep 收到 null/缺字段不抛错且不产生 NaN', () => {
    // onStepEnd 回调内异常会�?SDK 静默吞，recordStep 自身必须 no-throw
    expect(() => recordStep(null as unknown as StepRecord)).not.toThrow();
    expect(() => recordStep({} as StepRecord)).not.toThrow();
    expect(() => recordStep({ stepNumber: 1 } as StepRecord)).not.toThrow();

    const stats = getLLMStats();
    expect(Number.isNaN(stats.calls)).toBe(false);
    expect(Number.isNaN(stats.totalMs)).toBe(false);
    expect(Number.isNaN(stats.avgMs)).toBe(false);
    expect(Number.isNaN(stats.totalTokens)).toBe(false);
  });

  test('空状态：�?recordStep �?getLLMStats() 返回全零', () => {
    const stats = getLLMStats();
    expect(stats).toEqual({ calls: 0, totalMs: 0, avgMs: 0, totalTokens: 0 });
  });
});
