/**
 * 表情包生图 prompt 测试（#96）—— 图文分离硬契约断言
 *
 * 核心验收：生图 prompt 绝不含梗文字/文案内容（ADR-0001：模型不画字，
 * 文字由 overlay 程序叠加）。这里断言画面 prompt 是"画面指令"，不含任何
 * 文案文本，且明确禁止文字。
 */

import { describe, it, expect } from 'vitest';
import { buildMemeImagePrompt } from './prompt.js';

describe('buildMemeImagePrompt（图文分离）', () => {
  const copy = {
    text: '量子纠缠，人生纠缠', emotion: '自嘲', topic: '量子计算',
    scene: '橘猫同时抱着两台纠缠在一起的计算机，尾巴打结，露出无奈表情',
  };

  it('abstract：通用风格场景 + 情绪基调，不含文案文本', () => {
    const prompt = buildMemeImagePrompt(copy, 'abstract');
    expect(prompt).toContain('抽象梗图');
    expect(prompt).toContain('自嘲');
    expect(prompt).toContain(copy.scene);
    // 画面 prompt 绝不包含梗文案
    expect(prompt).not.toContain('量子纠缠');
    expect(prompt).not.toContain('人生纠缠');
    // 明确禁止模型画字/水印
    expect(prompt).toMatch(/不要任何文字|不要字母|不要.*文字/);
  });

  it('ip：宠物角色 + 参考图一致性，不含文案文本', () => {
    const prompt = buildMemeImagePrompt(copy, 'ip', '一只戴红色围巾的橘猫');
    expect(prompt).toContain('一只戴红色围巾的橘猫');
    expect(prompt).toContain('保持参考图中的物种');
    expect(prompt).toContain(copy.scene);
    expect(prompt).toContain('画面下方留出干净的纯色区域');
    expect(prompt).not.toContain('量子纠缠');
  });

  it('情绪映射：开心 → 欢快明亮', () => {
    const prompt = buildMemeImagePrompt({ text: 'x', emotion: '开心', topic: 't', scene: '猫抱着鱼缸转圈庆祝' }, 'abstract');
    expect(prompt).toContain('欢快明亮');
  });

  it('场景包含叠字原文时拒绝发送给生图', () => {
    expect(() => buildMemeImagePrompt({ ...copy, scene: `猫举牌写着${copy.text}` }, 'ip'))
      .toThrow('不能包含叠字文案原文');
  });
});
