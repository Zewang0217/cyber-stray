/**
 * 睡眠判定纯函数测试（#91）
 *
 * 契约：isSleeping(localHour, sleepStart, sleepEnd)
 * - 未设置（null）= 永不睡眠（默认兼容：行为与现状一致）
 * - 同日窗口 [start, end) 半开区间：end 时刻清醒
 * - 跨午夜窗口 [start, 24) ∪ [0, end)
 * - start === end = 空区间（防御：API 层已拒绝）
 */

import { describe, it, expect } from 'vitest';
import { isSleeping } from './sleep.js';

describe('isSleeping（作息睡眠判定）', () => {
  it('未设置作息（null）= 永不睡眠', () => {
    expect(isSleeping(0, null, null)).toBe(false);
    expect(isSleeping(12, null, null)).toBe(false);
    expect(isSleeping(23, null, null)).toBe(false);
    // 半设置（一端正一端 null）同视为未设置
    expect(isSleeping(12, null, 7)).toBe(false);
    expect(isSleeping(12, 22, null)).toBe(false);
  });

  it('同日窗口（9-22）：窗口内睡眠、端点边界正确', () => {
    expect(isSleeping(9, 9, 22)).toBe(true); // 起点入睡
    expect(isSleeping(15, 9, 22)).toBe(true);
    expect(isSleeping(21, 9, 22)).toBe(true);
    expect(isSleeping(22, 9, 22)).toBe(false); // 半开区间：end 时刻已醒
    expect(isSleeping(8, 9, 22)).toBe(false);
  });

  it('跨午夜窗口（22-7）：夜晚与凌晨睡眠中，7 点起清醒', () => {
    expect(isSleeping(22, 22, 7)).toBe(true);
    expect(isSleeping(23, 22, 7)).toBe(true);
    expect(isSleeping(1, 22, 7)).toBe(true);
    expect(isSleeping(6, 22, 7)).toBe(true);
    expect(isSleeping(7, 22, 7)).toBe(false); // 7:00 醒来
    expect(isSleeping(12, 22, 7)).toBe(false);
    expect(isSleeping(21, 22, 7)).toBe(false);
  });

  it('acceptance 场景：23:00-6:00 在 1:00 判定睡眠中', () => {
    expect(isSleeping(1, 23, 6)).toBe(true);
    expect(isSleeping(23, 23, 6)).toBe(true);
    expect(isSleeping(5, 23, 6)).toBe(true);
    expect(isSleeping(6, 23, 6)).toBe(false); // 6:00 醒
    expect(isSleeping(12, 23, 6)).toBe(false);
  });

  it('跨午夜反向边界：0 点入睡次日醒来', () => {
    // 0-8：0:00 入睡，8:00 醒
    expect(isSleeping(0, 0, 8)).toBe(true);
    expect(isSleeping(7, 0, 8)).toBe(true);
    expect(isSleeping(8, 0, 8)).toBe(false);
    expect(isSleeping(23, 0, 8)).toBe(false);
  });

  it('start === end（空区间，防御）= 永不睡眠', () => {
    expect(isSleeping(9, 9, 9)).toBe(false);
    expect(isSleeping(0, 0, 0)).toBe(false);
  });
});
