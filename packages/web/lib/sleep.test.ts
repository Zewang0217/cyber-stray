/**
 * 前端睡眠判定测试（#91 镜像 / #93 夜间状态判定）
 *
 * web 无法与 control-plane 共享模块（Next.js 客户端 vs Bun 服务端），
 * lib/sleep.ts 是 scheduler/sleep.ts 的逻辑镜像，改动必须同步两侧——
 * 本测试把同一份契约钉在前端侧，防单侧漂移。
 *
 * 梦境入口判定（#93）：入口条件 = isSleeping 为真。无作息配置（null）=
 * 永不睡眠 = 无梦境入口（issue 注记：无作息租户的梦境入口为后续彩蛋，本期不做）。
 */

import { describe, it, expect } from 'vitest';
import { isSleeping } from './sleep';

describe('isSleeping（作息睡眠判定，镜像 control-plane 契约）', () => {
  it('未设置作息（null）= 永不睡眠 = 无夜间状态/梦境入口', () => {
    expect(isSleeping(0, null, null)).toBe(false);
    expect(isSleeping(12, null, null)).toBe(false);
    expect(isSleeping(23, null, null)).toBe(false);
    // 半设置（一端正一端 null）同视为未设置
    expect(isSleeping(12, null, 7)).toBe(false);
    expect(isSleeping(12, 22, null)).toBe(false);
  });

  it('同日窗口（9-22）：窗口内睡眠、端点边界正确', () => {
    expect(isSleeping(9, 9, 22)).toBe(true);
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

  it('start === end（空区间，防御）= 永不睡眠', () => {
    expect(isSleeping(9, 9, 9)).toBe(false);
    expect(isSleeping(0, 0, 0)).toBe(false);
  });
});
