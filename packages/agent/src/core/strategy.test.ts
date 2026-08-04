/**
 * computeStrategy 单测（#61 验证标准自动化）
 *
 * 覆盖：精力边界（70/30）、无聊边界（80/40）、低精力强制 deep、
 * 心情→speakInclination、硬约束生成、空 focusTopics。
 */

import { describe, test, expect } from 'vitest';
import { computeStrategy } from './strategy.js';
import { makeState } from '../test/helpers.js';

const CEILING = 100;
const TOPICS = ['科技', 'AI', '互联网'];

describe('computeStrategy', () => {
  describe('精力 → maxSteps（比例缩放）', () => {
    test('精力 > 70 → ceiling（100）', () => {
      const s = computeStrategy(makeState({ energy: 71, boredom: 0 }), CEILING, TOPICS);
      expect(s.maxSteps).toBe(100);
    });

    test('精力 = 70（边界，非 >70）→ 60', () => {
      const s = computeStrategy(makeState({ energy: 70, boredom: 0 }), CEILING, TOPICS);
      expect(s.maxSteps).toBe(60);
    });

    test('精力 30-70 → round(ceiling × 0.6) = 60', () => {
      const s = computeStrategy(makeState({ energy: 50, boredom: 0 }), CEILING, TOPICS);
      expect(s.maxSteps).toBe(60);
    });

    test('精力 = 30（边界，>= 30）→ 60', () => {
      const s = computeStrategy(makeState({ energy: 30, boredom: 0 }), CEILING, TOPICS);
      expect(s.maxSteps).toBe(60);
    });

    test('精力 < 30 → round(ceiling × 0.2) = 20', () => {
      const s = computeStrategy(makeState({ energy: 29, boredom: 0 }), CEILING, TOPICS);
      expect(s.maxSteps).toBe(20);
    });

    test('精力 = 0 → 20', () => {
      const s = computeStrategy(makeState({ energy: 0, boredom: 0 }), CEILING, TOPICS);
      expect(s.maxSteps).toBe(20);
    });
  });

  describe('无聊 → explorationMode', () => {
    test('无聊 > 80 → novel', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 81 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('novel');
    });

    test('无聊 = 80（边界，非 >80）→ broad', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 80 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('broad');
    });

    test('无聊 40-80 → broad', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 60 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('broad');
    });

    test('无聊 = 40（边界，>= 40）→ broad', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 40 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('broad');
    });

    test('无聊 < 40 → deep', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 39 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('deep');
    });
  });

  describe('低精力覆盖探索模式', () => {
    test('精力 < 30 且无聊 > 80 → 强制 deep（不 novel）', () => {
      const s = computeStrategy(makeState({ energy: 20, boredom: 90 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('deep');
      expect(s.maxSteps).toBe(20);
    });

    test('精力 < 30 且无聊 < 40 → deep', () => {
      const s = computeStrategy(makeState({ energy: 20, boredom: 10 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('deep');
    });
  });

  describe('心情 → speakInclination', () => {
    test('excited → high', () => {
      const s = computeStrategy(makeState({ mood: 'excited' }), CEILING, TOPICS);
      expect(s.speakInclination).toBe('high');
    });

    test('playful → high', () => {
      const s = computeStrategy(makeState({ mood: 'playful' }), CEILING, TOPICS);
      expect(s.speakInclination).toBe('high');
    });

    test('lazy → low', () => {
      const s = computeStrategy(makeState({ mood: 'lazy' }), CEILING, TOPICS);
      expect(s.speakInclination).toBe('low');
    });

    test('emo → low', () => {
      const s = computeStrategy(makeState({ mood: 'emo' }), CEILING, TOPICS);
      expect(s.speakInclination).toBe('low');
    });

    test('curious → normal（默认）', () => {
      const s = computeStrategy(makeState({ mood: 'curious' }), CEILING, TOPICS);
      expect(s.speakInclination).toBe('normal');
    });

    test('grumpy → normal（默认）', () => {
      const s = computeStrategy(makeState({ mood: 'grumpy' }), CEILING, TOPICS);
      expect(s.speakInclination).toBe('normal');
    });
  });

  describe('硬约束生成', () => {
    test('focusTopics 非空 → top-1 约束', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 0 }), CEILING, TOPICS);
      expect(s.constraints.some((c) => c.includes('科技'))).toBe(true);
    });

    test('focusTopics 非空且 deep → 深耕约束', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 0 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('deep');
      expect(s.constraints.some((c) => c.includes('深耕'))).toBe(true);
    });

    test('novel → 探索新领域约束', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 90 }), CEILING, TOPICS);
      expect(s.explorationMode).toBe('novel');
      expect(s.constraints.some((c) => c.includes('没见过的领域'))).toBe(true);
    });

    test('focusTopics 为空 → 无 top-1 约束', () => {
      const s = computeStrategy(makeState({ energy: 100, boredom: 50 }), CEILING, []);
      expect(s.focusTopics).toEqual([]);
      expect(s.constraints.some((c) => c.includes('必须围绕'))).toBe(false);
    });
  });
});
