/**
 * sanitizeForLLM 测试（#125）
 *
 * 契约：移除孤立代理（高代理后无低代理、低代理前无高代理）；
 * 合法代理对（emoji）保留；正常文本不变；空串安全。
 */

import { describe, it, expect } from 'vitest';
import { sanitizeForLLM } from './text-sanitize.js';

describe('sanitizeForLLM（#125 孤立代理清洗）', () => {
  it('正常文本不变', () => {
    expect(sanitizeForLLM('你好，世界 hello world')).toBe('你好，世界 hello world');
  });

  it('移除孤立高代理（\\ud83d 后无低代理）', () => {
    const input = '分享内容: \ud83d\n- 列表';
    expect(sanitizeForLLM(input)).toBe('分享内容: \n- 列表');
  });

  it('移除孤立低代理（\\udc15 前无高代理）', () => {
    const input = '前缀 \udc15 后缀';
    expect(sanitizeForLLM(input)).toBe('前缀  后缀');
  });

  it('合法代理对（emoji 🐕）保留', () => {
    const emoji = '\ud83d\udc15';
    expect(sanitizeForLLM(`宠物 ${emoji} 在此`)).toBe(`宠物 ${emoji} 在此`);
  });

  it('空串安全', () => {
    expect(sanitizeForLLM('')).toBe('');
  });
});
