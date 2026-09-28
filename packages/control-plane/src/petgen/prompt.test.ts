/**
 * prompt 构建器测试（#94）
 *
 * 契约：概念图 prompt 含 spec 文本 + 风格预设片段 + 绿幕/禁文字约束；
 * 网格 prompt 按布局给出格线/空格指令；质检 prompt 要求 JSON 输出。
 */

import { describe, it, expect } from 'vitest';
import {
  PET_SHEET_ANIMS,
  PET_STYLE_PRESETS,
  type PetStateId,
} from '@cyber-stray/shared/pet';
import {
  buildAnimQcPrompt,
  buildConceptPrompt,
  buildGridPrompt,
  buildQcPrompt,
  buildSheetPrompt,
  buildStripPrompt,
  sheetRowOf,
} from './prompt.js';
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

describe('buildSheetPrompt / buildStripPrompt / buildAnimQcPrompt（领养精灵图）', () => {
  it('sheet prompt：网格规格 + 动画按帧数打包进 4 行 + 布局纪律', () => {
    const prompt = buildSheetPrompt(spec, PET_STYLE_PRESETS['pixel'], PET_SHEET_ANIMS, 4);
    expect(prompt).toContain('4x4');
    expect(prompt).toContain('一只戴红色围巾的橘猫');
    expect(prompt).toContain('恰好4行每行4格');
    // 第 1/2 行 = 单动画整行（idle/walk 各 4 帧）
    expect(prompt).toContain('第1行共4格,从左到右:待机呼吸(idle)连续帧:');
    expect(prompt).toContain('第2行共4格,从左到右:游荡(walk)连续帧:');
    // 第 3/4 行 = 两动画拼行（帧数打包，行数必须等于网格行数——错位 bug 回归锚）
    expect(prompt).toContain('第3行共4格,从左到右:休息(sleep)连续帧:'); 
    expect(prompt).toContain('不爽(grumpy)连续帧:');
    expect(prompt).toContain('第4行共4格,从左到右:开心(joy)连续帧:');
    expect(prompt).toContain('打招呼(welcome)连续帧:');
    expect(prompt).toContain('脚底都贴在同一水平线');
    expect(prompt).toContain('#00FF00');
  });

  it('sheet prompt：帧数总和 != n×n 抛错（防 prompt 与网格不符）', () => {
    expect(() =>
      buildSheetPrompt(spec, PET_STYLE_PRESETS['pixel'], [{ state: 'idle', frames: 4 }], 4),
    ).toThrow(/帧数总和/);
  });

  it('sheetRowOf：未知状态抛错（禁兜底）', () => {
    expect(() => sheetRowOf('不存在' as PetStateId)).toThrow(/未知宠物状态/);
  });

  it('strip prompt：1 行 N 列连续帧（降级策略）', () => {
    const prompt = buildStripPrompt(spec, PET_STYLE_PRESETS['pixel'], '开心', 2, '第1帧跳起,第2帧落地');
    expect(prompt).toContain('1 行 2 列');
    expect(prompt).toContain('开心');
    expect(prompt).toContain('第1帧跳起');
  });

  it('动画帧条质检 prompt：锚定参考图 + 帧间只抓身份跳变', () => {
    const prompt = buildAnimQcPrompt('walk', 4, spec);
    expect(prompt).toContain('4 帧');
    expect(prompt).toContain('第一张图是该角色的参考图');
    expect(prompt).toContain('帧间角色的物种/主配色/体型发生明显跳变');
    expect(prompt).toContain('姿态、大小、朝向的差异是动画的正常表现');
    expect(prompt).toContain('"pass"');
  });
});
