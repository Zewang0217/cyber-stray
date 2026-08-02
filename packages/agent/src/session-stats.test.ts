import { describe, test, expect } from 'vitest';
import { SessionStats } from './session-stats.js';

describe('SessionStats', () => {
  test('初始快照全零', () => {
    const snap = new SessionStats().snapshot();
    expect(snap.wanderRounds).toBe(0);
    expect(snap.totalSteps).toBe(0);
    expect(snap.pushes).toBe(0);
    expect(snap.likes).toBe(0);
    expect(snap.dislikes).toBe(0);
    expect(snap.errors).toBe(0);
    expect(snap.rounds).toHaveLength(0);
    expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  test('完整轮次：步数 + 推送统计', () => {
    const stats = new SessionStats();
    stats.beginRound();
    stats.recordStep();
    stats.recordStep();
    stats.recordStep();
    stats.endRound({ pushed: true });

    const snap = stats.snapshot();
    expect(snap.wanderRounds).toBe(1);
    expect(snap.totalSteps).toBe(3);
    expect(snap.pushes).toBe(1);
    expect(snap.rounds[0]).toMatchObject({ round: 1, steps: 3, pushed: true });
  });

  test('多轮累计', () => {
    const stats = new SessionStats();

    stats.beginRound();
    stats.recordStep();
    stats.endRound({ pushed: false });

    stats.beginRound();
    stats.recordStep();
    stats.recordStep();
    stats.endRound({ pushed: true });

    const snap = stats.snapshot();
    expect(snap.wanderRounds).toBe(2);
    expect(snap.totalSteps).toBe(3);
    expect(snap.pushes).toBe(1);
    expect(snap.rounds).toHaveLength(2);
    expect(snap.rounds[1]).toMatchObject({ round: 2, steps: 2, pushed: true });
  });

  test('进行中的轮次步数计入 totalSteps', () => {
    const stats = new SessionStats();
    stats.beginRound();
    stats.recordStep();
    stats.recordStep();
    // 不 endRound

    const snap = stats.snapshot();
    expect(snap.wanderRounds).toBe(0); // 未完成不算轮次
    expect(snap.totalSteps).toBe(2);   // 但步数已计入
  });

  test('beginRound 自动收尾未结束的轮次', () => {
    const stats = new SessionStats();
    stats.beginRound();
    stats.recordStep();
    // 忘记 endRound，直接开新一轮
    stats.beginRound();

    const snap = stats.snapshot();
    expect(snap.wanderRounds).toBe(1); // 第一轮被自动收尾
    expect(snap.rounds[0]).toMatchObject({ round: 1, steps: 1, pushed: false });
  });

  test('反馈计数', () => {
    const stats = new SessionStats();
    stats.recordFeedback('like');
    stats.recordFeedback('like');
    stats.recordFeedback('dislike');

    const snap = stats.snapshot();
    expect(snap.likes).toBe(2);
    expect(snap.dislikes).toBe(1);
  });

  test('错误计数', () => {
    const stats = new SessionStats();
    stats.recordError();
    stats.recordError();
    expect(stats.snapshot().errors).toBe(2);
  });

  test('无轮次时 recordStep 静默忽略', () => {
    const stats = new SessionStats();
    stats.recordStep(); // 不应抛错
    expect(stats.snapshot().totalSteps).toBe(0);
  });

  test('无轮次时 endRound 静默忽略', () => {
    const stats = new SessionStats();
    stats.endRound({ pushed: true }); // 不应抛错
    expect(stats.snapshot().pushes).toBe(0);
  });
});
