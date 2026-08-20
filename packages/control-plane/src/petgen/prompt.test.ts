/**
 * prompt 构建器测试（#94）
 *
 * 契约：概念图 prompt 含 spec 文本 + 风格预设片段 + 绿幕/禁文字约束；
 * 网格 prompt 按布局给出格线/空格指令；质检 prompt 要求 JSON 输出。
 */

import { describe, it, expect } from 'vitest';
import { PET_STYLE_PRESETS, type PetStateId } from '@cyber-stray/shared/pet';
import { buildConceptPrompt, buildGridPrompt, buildQcPrompt } from './prompt.js';
import type { PetSpec } from './types.js';

const spec: PetSpec = {
  specText: '一只戴红色围巾的橘猫',
  options: { palette: '橙色为主', size: '圆润' },
  stylePreset: 'chibi-kawaii',
};

describe('buildConceptPrompt', () => {
  it('含 spec 文本 + 风格片段 + 绿幕 + 禁文字水印', () => {
    const prompt = buildConceptPrompt(spec, PET_STYLE_PRESETS['chibi-kawaii']);
    expect(prompt).toContain('一只戴红色围巾的橘猫');
    expect(prompt).toContain(PET_STYLE_PRESETS['chibi-kawaii'].promptFragment);
    expect(prompt).toContain('#00FF00');
    expect(prompt).toContain('不要文字');
    expect(prompt).toContain('不要水印');
  });

  it('选项拼进 prompt（存在才追加）', () => {
    const prompt = buildConceptPrompt(spec, PET_STYLE_PRESETS['chibi-kawaii']);
    expect(prompt).toContain('主色调偏好:橙色为主');
    expect(prompt).toContain('体型偏好:圆润');
    const noOptions = buildConceptPrompt({ specText: '一只猫' }, PET_STYLE_PRESETS['pixel']);
    expect(noOptions).not.toContain('主色调偏好');
  });
});

describe('buildGridPrompt', () => {
  it('2x2：3 状态 + 右下角留空指令', () => {
    const prompt = buildGridPrompt(spec, PET_STYLE_PRESETS['chibi-kawaii'], ['idle', 'walk', 'joy'], '2x2');
    expect(prompt).toContain('idle');
    expect(prompt).toContain('2x2');
    expect(prompt).toContain('右下角必须留空');
    expect(prompt).toContain('#00FF00');
  });

  it('3x3：9 状态行优先', () => {
    const states: PetStateId[] = ['idle', 'walk', 'joy', 'eat', 'sleep', 'think', 'celebrate', 'grumpy', 'welcome'];
    const prompt = buildGridPrompt(spec, PET_STYLE_PRESETS['chibi-kawaii'], states, '3x3');
    expect(prompt).toContain('3x3');
    expect(prompt).toContain('行优先');
    expect(prompt).toContain('celebrate');
  });

  it('1x1：单状态单图', () => {
    const prompt = buildGridPrompt(spec, PET_STYLE_PRESETS['chibi-kawaii'], ['sleep'], '1x1');
    expect(prompt).toContain('画面中央 1 个角色');
    expect(prompt).toContain('sleep');
  });
});

describe('buildQcPrompt', () => {
  it('含状态名 + 判定条件 + JSON 输出要求', () => {
    const prompt = buildQcPrompt('joy', spec);
    expect(prompt).toContain('开心');
    expect(prompt).toContain('"pass"');
    expect(prompt).toContain('文字、水印');
    expect(prompt).toContain('畸形');
  });
});
