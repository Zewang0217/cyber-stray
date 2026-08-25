/**
 * 睡前任务触发判定测试（#92）
 *
 * 契约：
 * - 有作息：睡眠开始（awake→asleep 跳变）触发；睡眠中持续不重复；跨午夜同睡
 *   眠期不重复；同日已生成不重跑
 * - 无作息：固定每日时刻（23 点）触发一次；其他时刻不触发
 * - 今天已生成 → 一律不触发
 */

import { describe, it, expect } from 'vitest';
import { DIARY_FALLBACK_HOUR, shouldGenerateDiary } from './diary-schedule.js';

const TODAY = '2026-08-20';

describe('shouldGenerateDiary（有作息配置：睡眠开始触发）', () => {
  it('睡眠开始（本 tick 进入睡眠窗口）→ 触发', () => {
    expect(
      shouldGenerateDiary({
        localHour: 22,
        today: TODAY,
        sleepStart: 22,
        sleepEnd: 7,
        lastDiaryDate: null,
        wasSleeping: false,
      }),
    ).toBe(true);
  });

  it('睡眠中持续（wasSleeping=true，无跳变）→ 不重复触发', () => {
    expect(
      shouldGenerateDiary({
        localHour: 22,
        today: TODAY,
        sleepStart: 22,
        sleepEnd: 7,
        lastDiaryDate: null,
        wasSleeping: true,
      }),
    ).toBe(false);
  });

  it('今天已生成（lastDiaryDate === today）→ 睡眠中也不触发', () => {
    expect(
      shouldGenerateDiary({
        localHour: 22,
        today: TODAY,
        sleepStart: 22,
        sleepEnd: 7,
        lastDiaryDate: TODAY,
        wasSleeping: false,
      }),
    ).toBe(false);
  });

  it('清醒时（非睡眠窗口）→ 不触发', () => {
    expect(
      shouldGenerateDiary({
        localHour: 14,
        today: TODAY,
        sleepStart: 22,
        sleepEnd: 7,
        lastDiaryDate: null,
        wasSleeping: false,
      }),
    ).toBe(false);
  });

  it('跨午夜睡眠：入睡日触发，次日仍在睡不重复', () => {
    // 22:00 入睡 → 触发
    expect(
      shouldGenerateDiary({
        localHour: 22,
        today: '2026-08-20',
        sleepStart: 22,
        sleepEnd: 7,
        lastDiaryDate: null,
        wasSleeping: false,
      }),
    ).toBe(true);
    // 次日 01:00 仍在睡（wasSleeping=true，lastDiaryDate=入睡日）→ 不触发
    expect(
      shouldGenerateDiary({
        localHour: 1,
        today: '2026-08-21',
        sleepStart: 22,
        sleepEnd: 7,
        lastDiaryDate: '2026-08-20',
        wasSleeping: true,
      }),
    ).toBe(false);
  });

  it('非跨午夜作息（7-15）：睡眠开始触发、睡眠中不重复', () => {
    expect(
      shouldGenerateDiary({
        localHour: 7,
        today: TODAY,
        sleepStart: 7,
        sleepEnd: 15,
        lastDiaryDate: null,
        wasSleeping: false,
      }),
    ).toBe(true);
    expect(
      shouldGenerateDiary({
        localHour: 9,
        today: TODAY,
        sleepStart: 7,
        sleepEnd: 15,
        lastDiaryDate: null,
        wasSleeping: true,
      }),
    ).toBe(false);
  });
});

describe('shouldGenerateDiary（无作息配置：固定每日时刻）', () => {
  it(`固定时刻（${DIARY_FALLBACK_HOUR} 点）且今天未生成 → 触发`, () => {
    expect(
      shouldGenerateDiary({
        localHour: DIARY_FALLBACK_HOUR,
        today: TODAY,
        sleepStart: null,
        sleepEnd: null,
        lastDiaryDate: null,
        wasSleeping: false,
      }),
    ).toBe(true);
  });

  it('固定时刻但今天已生成 → 不触发', () => {
    expect(
      shouldGenerateDiary({
        localHour: DIARY_FALLBACK_HOUR,
        today: TODAY,
        sleepStart: null,
        sleepEnd: null,
        lastDiaryDate: TODAY,
        wasSleeping: false,
      }),
    ).toBe(false);
  });

  it('非固定时刻 → 不触发', () => {
    expect(
      shouldGenerateDiary({
        localHour: 12,
        today: TODAY,
        sleepStart: null,
        sleepEnd: null,
        lastDiaryDate: null,
        wasSleeping: false,
      }),
    ).toBe(false);
  });
});
