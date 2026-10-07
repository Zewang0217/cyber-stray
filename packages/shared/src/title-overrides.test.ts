import { describe, expect, it } from 'vitest';
import { TITLE_OVERRIDE_MAX_ENTRIES, TitleOverridesSchema } from './title-overrides.js';

describe('标题覆盖契约', () => {
  it('仅接受稳定 UUID 与有界单文件映射', () => {
    const entry = { title: '小黑猫撞见 AI 新研究', sourceType: 'share',
      oldTitle: '喵！今天发现一项研究。', titleSourceAbsent: true,
      timestamp: '2026-10-07T08:00:00Z',
      contentSha256: 'a'.repeat(64) };
    expect(TitleOverridesSchema.parse({ version: 1, entries: {
      'aaaaaaaa-0000-4000-8000-000000000001': entry,
    } }).entries).toHaveProperty('aaaaaaaa-0000-4000-8000-000000000001');
    expect(() => TitleOverridesSchema.parse({ version: 1, entries: { 'not-an-id': entry } })).toThrow();
    const entries = Object.fromEntries(Array.from({ length: TITLE_OVERRIDE_MAX_ENTRIES + 1 }, (_, index) => [
      `aaaaaaaa-0000-4000-8000-${index.toString(16).padStart(12, '0')}`, entry,
    ]));
    expect(() => TitleOverridesSchema.parse({ version: 1, entries })).toThrow();
  });
});
