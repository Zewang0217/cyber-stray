/**
 * 性格注册表测试
 *
 * 契约（#90）：
 * - 注册表可拓展：新增性格 = 注册表加一行，核心逻辑零改动（无 switch/if 分支遍历）
 * - 每性格一组 { 优劣描述, 参数倍率, 游荡效果偏移, 探索倾向, 语气 prompt, 日记/梦境风格 }
 * - 好奇 = 基准倍率 1.0（存量宠物行为不回退）；懒 vs 好奇无聊增速差异显著
 * - 未知性格显式抛错（禁兜底）
 */

import { describe, it, expect } from 'vitest';
import {
  PERSONALITY_IDS,
  DEFAULT_PERSONALITY,
  getPersonality,
  isPersonalityId,
  listPersonalities,
  parseCatchphraseList,
  CATCHPHRASE_WEIGHT_FLOOR,
  type PersonalityId,
  type PersonalityProfile,
} from './personality.js';

/** 每性格必备的字段清单（新增性格漏字段会在这里被抓住） */
const REQUIRED_KEYS = [
  'id',
  'name',
  'description',
  'strengths',
  'weaknesses',
  'rates',
  'wander',
  'exploration',
  'tonePrompt',
  'catchphrases',
  'dreamStyle',
] as const;

describe('性格注册表', () => {
  it('起步四性格：好奇/活泼/慵懒/沉稳', () => {
    expect(PERSONALITY_IDS).toEqual(['curious', 'playful', 'lazy', 'steady']);
  });

  it('每条目字段齐全且结构合法（注册表可拓展的完整性守卫）', () => {
    for (const id of PERSONALITY_IDS) {
      const p = getPersonality(id);
      for (const key of REQUIRED_KEYS) {
        expect(p, `${id} 缺字段 ${key}`).toHaveProperty(key);
      }
      // 倍率必须为正（0 或负会毁掉前推）
      expect(p.rates.boredomPerMinute).toBeGreaterThan(0);
      expect(p.rates.energyPerMinute).toBeGreaterThan(0);
      // 游荡系数为正
      expect(p.wander.boredomRelief).toBeGreaterThan(0);
      expect(p.wander.energyCost).toBeGreaterThan(0);
      // 探索权重在 0-1 区间
      expect(p.exploration.novelty).toBeGreaterThanOrEqual(0);
      expect(p.exploration.novelty).toBeLessThanOrEqual(1);
      expect(p.exploration.familiarity).toBeGreaterThanOrEqual(0);
      expect(p.exploration.familiarity).toBeLessThanOrEqual(1);
      // 优劣、语气、日记风格非空（展示/注入需要）
      expect(p.strengths.length).toBeGreaterThan(0);
      expect(p.weaknesses.length).toBeGreaterThan(0);
      expect(p.tonePrompt.trim().length).toBeGreaterThan(0);
      expect(p.diaryStyle.trim().length).toBeGreaterThan(0);
      expect(p.dreamStyle.trim().length).toBeGreaterThan(0);
    }
  });

  it('好奇是产品默认且为基准倍率 1.0（存量宠物行为不回退）', () => {
    expect(DEFAULT_PERSONALITY).toBe('curious');
    const curious = getPersonality('curious');
    expect(curious.rates.boredomPerMinute).toBe(1);
    expect(curious.rates.energyPerMinute).toBe(1);
    expect(curious.wander.boredomRelief).toBe(1);
    expect(curious.wander.energyCost).toBe(1);
  });

  it('好奇无聊增速显著快于慵懒（acceptance：行为参数实测不同）', () => {
    const curious = getPersonality('curious');
    const lazy = getPersonality('lazy');
    expect(curious.rates.boredomPerMinute).toBeGreaterThan(lazy.rates.boredomPerMinute * 1.5);
  });

  it('探索倾向：好奇偏新话题、慵懒偏旧话题', () => {
    const curious = getPersonality('curious');
    const lazy = getPersonality('lazy');
    expect(curious.exploration.novelty).toBeGreaterThan(curious.exploration.familiarity);
    expect(lazy.exploration.novelty).toBeLessThan(lazy.exploration.familiarity);
  });

  it('isPersonalityId：合法 id 为 true，其余为 false', () => {
    expect(isPersonalityId('curious')).toBe(true);
    expect(isPersonalityId('lazy')).toBe(true);
    expect(isPersonalityId('grumpy')).toBe(false);
    expect(isPersonalityId(undefined)).toBe(false);
    expect(isPersonalityId('')).toBe(false);
  });

  it('getPersonality 未知 id 抛错（禁兜底）', () => {
    expect(() => getPersonality('grumpy')).toThrow(/grumpy/);
  });

  it('listPersonalities 覆盖全部注册性格', () => {
    const all = listPersonalities();
    expect(all.map((p) => p.id)).toEqual([...PERSONALITY_IDS]);
    expect(all.every((p) => typeof p.name === 'string')).toBe(true);
  });

  it('注册表驱动而非分支：任意 id 的解析都走同一查找路径', () => {
    // 结构断言：PERSONALITIES 与 PERSONALITY_IDS 一一对应（防手写遗漏）
    const ids = listPersonalities().map((p) => p.id);
    expect([...ids].sort()).toEqual([...PERSONALITY_IDS].sort());
  });

  // 类型层面证明可拓展：新性格只需在 PERSONALITIES 里加一条同构条目
  it('类型健全：PersonalityProfile 是完整同构结构', () => {
    const p: PersonalityProfile = getPersonality(DEFAULT_PERSONALITY);
    const id: PersonalityId = p.id;
    expect(id).toBe('curious');
  });
});

describe('口头禅（#114 切片 2）', () => {
  it('每性格默认组 3-6 条、纯文字（无 emoji）、权重 ≥ 下限', () => {
    for (const id of PERSONALITY_IDS) {
      const list = getPersonality(id).catchphrases;
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list.length).toBeLessThanOrEqual(6);
      for (const c of list) {
        expect(c.text.length).toBeGreaterThan(0);
        expect(c.weight).toBeGreaterThanOrEqual(CATCHPHRASE_WEIGHT_FLOOR);
        // 纯文字不带 emoji（ADR 0005：emoji 交 LLM 自然发挥）
        expect(c.text).toMatch(/^[\p{Script=Han}\p{P}\p{S}a-zA-Z0-9\s?！!…—()·]+$/u);
      }
    }
  });

  it('parseCatchphraseList：合法输入规范化（trim），非法输入给 400 消息', () => {
    const ok = parseCatchphraseList([
      { text: ' 喵。 ', weight: 1 },
      { text: '嗯,知道了', weight: 0.5 },
    ]);
    expect(ok).toEqual([
      { text: '喵。', weight: 1 },
      { text: '嗯,知道了', weight: 0.5 },
    ]);
    expect(typeof parseCatchphraseList([])).toBe('string');
    expect(typeof parseCatchphraseList('not-array')).toBe('string');
    expect(typeof parseCatchphraseList([{ text: '', weight: 1 }])).toBe('string');
    expect(typeof parseCatchphraseList([{ text: 'x'.repeat(25), weight: 1 }])).toBe('string');
    expect(typeof parseCatchphraseList([{ text: '喵', weight: -1 }])).toBe('string');
    expect(typeof parseCatchphraseList([{ text: '喵', weight: 0.01 }])).toBe('string');
    expect(
      typeof parseCatchphraseList(
        Array.from({ length: 7 }, () => ({ text: '喵', weight: 1 })),
      ),
    ).toBe('string');
  });
});
