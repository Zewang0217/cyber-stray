/**
 * 日记风格选项测试（#92）
 *
 * 契约：
 * - 三档具体风格（casual/careful/literary）+ 默认 'personality'（跟随性格）
 * - isDiaryStyleId / isDiaryStyleChoice 校验严格（禁兜底：非法值 false 非静默默认）
 * - resolveDiaryStylePrompt：'personality' → 性格模板；具体风格 → 对应语气段；
 *   未知风格抛错（禁兜底）
 */

import { describe, it, expect } from 'vitest';
import {
  DIARY_STYLES,
  DEFAULT_DIARY_STYLE,
  DIARY_STYLE_NAMES,
  DIARY_STYLE_PROMPTS,
  isDiaryStyleId,
  isDiaryStyleChoice,
  resolveDiaryStylePrompt,
} from './diary.js';

describe('日记风格选项', () => {
  it('三档具体风格 + 默认随性格', () => {
    expect(DIARY_STYLES).toEqual(['casual', 'careful', 'literary']);
    expect(DEFAULT_DIARY_STYLE).toBe('personality');
  });

  it('每个具体风格都有显示名与语气 prompt（完整性守卫）', () => {
    for (const id of DIARY_STYLES) {
      expect(typeof DIARY_STYLE_NAMES[id]).toBe('string');
      expect(DIARY_STYLE_NAMES[id].length).toBeGreaterThan(0);
      expect(typeof DIARY_STYLE_PROMPTS[id]).toBe('string');
      expect(DIARY_STYLE_PROMPTS[id].length).toBeGreaterThan(0);
    }
  });

  it("isDiaryStyleId：合法具体风格为 true，'personality'/未知为 false", () => {
    expect(isDiaryStyleId('casual')).toBe(true);
    expect(isDiaryStyleId('personality')).toBe(false);
    expect(isDiaryStyleId('grumpy')).toBe(false);
    expect(isDiaryStyleId(123)).toBe(false);
  });

  it('isDiaryStyleChoice：具体风格与 personality 均为 true，未知为 false', () => {
    expect(isDiaryStyleChoice('personality')).toBe(true);
    expect(isDiaryStyleChoice('literary')).toBe(true);
    expect(isDiaryStyleChoice('grumpy')).toBe(false);
    expect(isDiaryStyleChoice(undefined)).toBe(false);
  });

  it("resolveDiaryStylePrompt：'personality' → 性格注册表模板", () => {
    const personalityDiaryStyle = '记录当天发现的趣闻与新兴趣，带着惊叹语气';
    expect(resolveDiaryStylePrompt('personality', personalityDiaryStyle)).toBe(
      personalityDiaryStyle,
    );
  });

  it('resolveDiaryStylePrompt：具体风格 → 对应语气段', () => {
    expect(resolveDiaryStylePrompt('casual', '性格模板')).toBe(DIARY_STYLE_PROMPTS.casual);
    expect(resolveDiaryStylePrompt('literary', '性格模板')).toBe(DIARY_STYLE_PROMPTS.literary);
  });

  it('resolveDiaryStylePrompt：未知风格抛错（禁兜底）', () => {
    expect(() => resolveDiaryStylePrompt('grumpy' as never, 'x')).toThrow(/grumpy/);
  });
});
