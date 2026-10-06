import { describe, expect, it } from 'vitest';
import { PET_SHEET_ANIMS, PET_STATES, PET_STATE_IDS } from './pet.js';
import { parsePetAppearance, petAnimationFor } from './pet-appearance.js';

const classic = () => ({
  version: 1,
  generatedAt: '2026-10-05T00:00:00.000Z',
  states: Object.fromEntries(PET_STATE_IDS.map((state) => [state, { ...PET_STATES[state], frames: 1 }])),
});

function sheet() {
  let from = 0;
  return {
    ...classic(), version: 2, states: {},
    sprite: {
      image: 'sprite.png', frame: { w: 64, h: 64, groundRow: 63 }, displayScale: 2,
      animations: Object.fromEntries(PET_SHEET_ANIMS.map(({ state, frames, duration }) => {
        const animation = { from, frames, duration, loop: true };
        from += frames;
        return [state, animation];
      })),
    },
  };
}

describe('可播放宠物素材契约', () => {
  it('接收 quad/nine/per 共用的完整经典九态 manifest', () => {
    const appearance = parsePetAppearance(classic());
    expect(appearance.kind).toBe('states');
    if (appearance.kind !== 'states') throw new Error('须为经典素材');
    expect(Object.keys(appearance.states)).toEqual(PET_STATE_IDS);
    expect(appearance.states.sleep).toEqual({ ...PET_STATES.sleep, frames: 1 });
  });

  it.each(PET_STATE_IDS)('经典素材缺 %s 时明确失败', (state) => {
    const manifest = classic();
    delete manifest.states[state];
    expect(() => parsePetAppearance(manifest)).toThrow();
  });

  it.each([
    { file: '../idle' }, { file: 'https://evil.test/idle' }, { frames: 3 },
    { dur: 0 }, { dur: '1' }, { label: '' },
  ])('经典状态字段损坏不能静默回到内置猫：%j', (bad) => {
    const manifest = classic();
    Object.assign(manifest.states.idle!, bad);
    expect(() => parsePetAppearance(manifest)).toThrow();
  });

  it('保留 sheet 播放契约和原始帧序；旧 sheet 缺 displayScale 时使用文档约定的 3', () => {
    const manifest = sheet();
    const appearance = parsePetAppearance(manifest);
    expect(appearance.kind).toBe('sprite');
    if (appearance.kind !== 'sprite') throw new Error('须为精灵图素材');
    expect(appearance.contract.animations).toEqual(manifest.sprite.animations);
    expect(appearance.scale).toBe(2);
    expect(appearance.contract.overlays).toBeUndefined();
    expect(parsePetAppearance({ ...manifest, sprite: { ...manifest.sprite, displayScale: undefined } }))
      .toMatchObject({ kind: 'sprite', scale: 3 });
  });

  it('sheet 缺必要状态或帧偏移错误均明确失败', () => {
    const missing = sheet();
    delete missing.sprite.animations.welcome;
    expect(() => parsePetAppearance(missing)).toThrow(/welcome/);
    const broken = sheet();
    broken.sprite.animations.walk!.from = 99;
    expect(() => parsePetAppearance(broken)).toThrow(/不连续/);
  });

  it.each([0, -2, 2.5, '3', null, 9])('sheet 非法 displayScale %j 明确失败', (displayScale) => {
    const manifest = sheet();
    expect(() => parsePetAppearance({ ...manifest, sprite: { ...manifest.sprite, displayScale } })).toThrow();
  });

  it('拒绝缺 sprite 的 v2、未知版本、坏时间与空数据', () => {
    for (const bad of [null, {}, { ...classic(), version: 2 }, { ...classic(), version: 9 }, { ...classic(), generatedAt: 'bad' }]) {
      expect(() => parsePetAppearance(bad)).toThrow();
    }
  });

  it('经典九态均可播放；拍拍/扑跳为 joy，sleep 保留；sheet 保留既有映射', () => {
    for (const state of PET_STATE_IDS) expect(petAnimationFor('states', state)).toBe(state);
    for (const kind of ['states', 'sprite'] as const) {
      expect(petAnimationFor(kind, 'pat')).toBe('joy');
      expect(petAnimationFor(kind, 'pounce')).toBe('joy');
      expect(petAnimationFor(kind, 'sleep')).toBe('sleep');
      expect(() => petAnimationFor(kind, 'missing')).toThrow();
    }
    expect(petAnimationFor('sprite', 'eat')).toBe('idle');
    expect(petAnimationFor('sprite', 'celebrate')).toBe('joy');
  });
});
