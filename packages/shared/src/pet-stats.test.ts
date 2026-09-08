import { describe, it, expect } from 'vitest';
import { parsePetStats, parseFeedbackPetState, isPetMood } from './pet-stats.js';

describe('parsePetStats（wander 通道全量形状）', () => {
  it('合法全量注入解析成功', () => {
    expect(parsePetStats({ energy: 80, boredom: 70, mood: 'curious', temper: 20 })).toEqual({
      energy: 80,
      boredom: 70,
      mood: 'curious',
      temper: 20,
    });
  });

  it('缺字段/ Mood 非法/ 非有限数 → null（调用方显式失败）', () => {
    // 回归（#216 评审 P0-1 的镜像）：feedback 只传 {mood,temper} 在全量校验器下必须判非法
    expect(parsePetStats({ mood: 'curious', temper: 20 })).toBeNull();
    expect(parsePetStats({ energy: 80, boredom: 70, mood: 'not-a-mood', temper: 20 })).toBeNull();
    expect(parsePetStats({ energy: NaN, boredom: 70, mood: 'curious', temper: 20 })).toBeNull();
    expect(parsePetStats(null)).toBeNull();
    expect(parsePetStats('json')).toBeNull();
  });
});

describe('parseFeedbackPetState（feedback 通道子形状）', () => {
  it('只含 mood/temper 的 CP 注入解析成功（P0-1 回归）', () => {
    expect(parseFeedbackPetState({ mood: 'curious', temper: 20 })).toEqual({
      mood: 'curious',
      temper: 20,
    });
  });

  it('缺 temper / temper 非数 / mood 非法 → null', () => {
    expect(parseFeedbackPetState({ mood: 'curious' })).toBeNull();
    expect(parseFeedbackPetState({ mood: 'curious', temper: 'x' })).toBeNull();
    expect(parseFeedbackPetState({ mood: 'angry', temper: 20 })).toBeNull();
    expect(parseFeedbackPetState(undefined)).toBeNull();
  });
});

describe('isPetMood', () => {
  it('枚举内外判定', () => {
    expect(isPetMood('emo')).toBe(true);
    expect(isPetMood('sleepy')).toBe(false);
    expect(isPetMood(42)).toBe(false);
  });
});
