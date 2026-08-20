/**
 * 表情包文案生成器测试（#96）
 *
 * - buildMemeCopyPrompt：话题/宠物名/性格注入，只产出 JSON 指令
 * - parseMemeCopy：校验 LLM 产出（话题回显对账）；非法产出抛错（禁兜底）
 * - 图文分离断言：文案 prompt 不要求模型画字（只出文字），生图 prompt 不
 *   含梗文字（见 prompt.test.ts 交叉断言）
 */

import { describe, it, expect } from 'vitest';
import { buildMemeCopyPrompt, parseMemeCopy } from './copy.js';

describe('buildMemeCopyPrompt', () => {
  it('注入话题/宠物名/性格，产出 JSON 指令', () => {
    const prompt = buildMemeCopyPrompt({
      topic: '量子计算',
      petName: '小七',
      personalityName: '好奇',
    });
    expect(prompt).toContain('小七');
    expect(prompt).toContain('好奇');
    expect(prompt).toContain('量子计算');
    expect(prompt).toContain('JSON');
    // 文案 prompt 是纯文字指令，不涉及生图
    expect(prompt).not.toMatch(/画|image|prompt for.*image/i);
  });

  it('无性格时省略性格段（不含"性格："注入）', () => {
    const prompt = buildMemeCopyPrompt({ topic: 'AI', petName: '小七' });
    expect(prompt).toContain('小七');
    expect(prompt).not.toMatch(/性格：/);
    expect(prompt).not.toMatch(/（性格/);
  });
});

describe('parseMemeCopy', () => {
  it('解析合法产出（含 markdown 围栏），话题回显用于对账', () => {
    const copy = parseMemeCopy(
      '```json\n{"text": "量子纠缠，人生纠缠", "emotion": "自嘲", "topic": "量子计算"}\n```',
      '量子计算',
    );
    expect(copy.text).toBe('量子纠缠，人生纠缠');
    expect(copy.emotion).toBe('自嘲');
    expect(copy.topic).toBe('量子计算');
  });

  it('话题缺失时回退到 expectedTopic（防 LLM 漂移）', () => {
    const copy = parseMemeCopy('{"text": "好耶", "emotion": "开心"}', 'AI');
    expect(copy.topic).toBe('AI');
  });

  it('非法产出（缺字段）→ 显式抛错（禁兜底）', () => {
    expect(() => parseMemeCopy('{"text": "只有文案"}', 'AI')).toThrow();
    expect(() => parseMemeCopy('不是 JSON', 'AI')).toThrow();
  });
});
