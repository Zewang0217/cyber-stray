/**
 * UserProfile 测试
 *
 * 覆盖：加载/持久化 round-trip、Zod schema 校验、抛错 vs 默认值边界、
 * 置信度 sigmoid 校准、sampleCount 无界、冷却期、旧数据迁移。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import {
  loadUserProfile,
  saveUserProfile,
  updateUserProfile,
  tryUpdateUserProfile,
  UserProfileSchema,
} from './user-profile.js';
import { useTempDataDir } from '../test/helpers.js';

describe('UserProfile', () => {
  let cleanup: () => void;
  let dataDir: string;

  beforeEach(() => {
    const temp = useTempDataDir();
    cleanup = temp.cleanup;
    dataDir = temp.dataDir;
  });

  afterEach(() => {
    cleanup();
  });

  // ----------------------------------------
  // 加载：文件不存在 → 默认画像
  // ----------------------------------------

  it('should return default profile when file does not exist', async () => {
    const profile = await loadUserProfile();
    expect(profile.likes).toEqual([]);
    expect(profile.dislikes).toEqual([]);
    expect(profile.feedbackCount).toBe(0);
    expect(profile.sampleCount).toBe(0);
    expect(profile.confidence).toBe(0);
    expect(profile.lastProfileUpdateAt).toBeNull();
  });

  // ----------------------------------------
  // 加载：非法 JSON → 抛错
  // ----------------------------------------

  it('should throw on corrupted JSON', async () => {
    await mkdir(`${dataDir}/memory`, { recursive: true });
    await writeFile(`${dataDir}/memory/user-profile.json`, 'not-json', 'utf-8');

    expect(loadUserProfile()).rejects.toThrow('用户画像解析失败');
  });

  // ----------------------------------------
  // 加载：schema 不匹配 → 抛错
  // ----------------------------------------

  it('should throw on schema mismatch', async () => {
    await mkdir(`${dataDir}/memory`, { recursive: true });
    // likes 应该是 string[]，给 number 触发 schema 失败
    const invalid = JSON.stringify({ likes: [123], dislikes: [], lastUpdated: 'bad-date' });
    await writeFile(`${dataDir}/memory/user-profile.json`, invalid, 'utf-8');

    expect(loadUserProfile()).rejects.toThrow('用户画像 schema 校验失败');
  });

  // ----------------------------------------
  // 持久化 round-trip
  // ----------------------------------------

  it('should round-trip profile through save and load', async () => {
    const profile = await loadUserProfile();
    profile.likes.push('量子计算');
    profile.sampleCount = 5;
    profile.confidence = 0.33;
    await saveUserProfile(profile);

    const loaded = await loadUserProfile();
    expect(loaded.likes).toEqual(['量子计算']);
    expect(loaded.sampleCount).toBe(5);
    expect(loaded.confidence).toBe(0.33);
  });

  // ----------------------------------------
  // updateUserProfile: like
  // ----------------------------------------

  it('should dissolve likes/dislikes (S1): only count samples, no array mutation', async () => {
    // 先手动构造一个 dislike 状态（旧数据兼容）
    const profile = await loadUserProfile();
    profile.dislikes.push('AI');
    await saveUserProfile(profile);

    const updated = await updateUserProfile('like', 'AI');
    // S1（#150）：likes/dislikes 概念消解为图谱叶子权重——不再写数组，
    // 旧数组原样保留（信号落图谱由 feedback-pipeline 负责，S2 精确归因）
    expect(updated.likes).toEqual([]);
    expect(updated.dislikes).toEqual(['AI']);
    expect(updated.sampleCount).toBe(1);
    expect(updated.feedbackCount).toBe(1);
  });

  it('should not write likes entries on repeated like (S1)', async () => {
    await updateUserProfile('like', '科技');
    const updated = await updateUserProfile('like', '科技');
    expect(updated.likes).toEqual([]);
    expect(updated.sampleCount).toBe(2);
  });

  // ----------------------------------------
  // updateUserProfile: dislike
  // ----------------------------------------

  it('should not write dislikes entries (S1)', async () => {
    const profile = await loadUserProfile();
    profile.likes.push('广告');
    await saveUserProfile(profile);

    const updated = await updateUserProfile('dislike', '广告');
    expect(updated.dislikes).toEqual([]);
    expect(updated.likes).toEqual(['广告']);
    expect(updated.sampleCount).toBe(1);
  });

  // ----------------------------------------
  // sampleCount 无界递增
  // ----------------------------------------

  it('should increment sampleCount unbounded', async () => {
    let profile = await loadUserProfile();
    expect(profile.sampleCount).toBe(0);

    // 大量反馈不封顶
    for (let i = 0; i < 100; i++) {
      profile = await updateUserProfile('like', `topic-${i}`);
    }
    expect(profile.sampleCount).toBe(100);
  });

  // ----------------------------------------
  // 置信度 sigmoid 校准
  // ----------------------------------------

  it('should compute sigmoid confidence: sampleCount/(sampleCount+10)', async () => {
    let profile = await loadUserProfile();

    // 0 样本 → 0
    expect(profile.confidence).toBe(0);

    // 1 样本 → 1/11 ≈ 0.09
    profile = await updateUserProfile('like', 'topic-1');
    expect(profile.confidence).toBeCloseTo(1 / 11, 1);

    // 5 样本 → 5/15 ≈ 0.33
    for (let i = 0; i < 4; i++) {
      profile = await updateUserProfile('like', `extra-${i}`);
    }
    expect(profile.sampleCount).toBe(5);
    expect(profile.confidence).toBeCloseTo(5 / 15, 1);
  });

  it('should cap confidence at 0.95', async () => {
    // 构造已有高 sampleCount 的画像
    const profile = await loadUserProfile();
    profile.sampleCount = 999;
    profile.confidence = 0.99;
    await saveUserProfile(profile);

    const updated = await updateUserProfile('like', 'cap-test');
    // sigmoid: 1000/(1000+10) ≈ 0.99，但应被 cap 到 0.95
    expect(updated.confidence).toBeLessThanOrEqual(0.95);
  });

  // ----------------------------------------
  // 旧数据迁移（feedbackCount → sampleCount）
  // ----------------------------------------

  it('should migrate old feedbackCount to sampleCount', async () => {
    await mkdir(`${dataDir}/memory`, { recursive: true });
    // 模拟旧格式：有 feedbackCount 但无 sampleCount
    const oldData = {
      likes: ['AI'],
      dislikes: [],
      lastUpdated: new Date().toISOString(),
      feedbackCount: 15,
      confidence: 0.75,
      lastProfileUpdateAt: null,
    };
    await writeFile(`${dataDir}/memory/user-profile.json`, JSON.stringify(oldData), 'utf-8');

    const loaded = await loadUserProfile();
    // sampleCount 应从 feedbackCount 迁移
    expect(loaded.sampleCount).toBe(15);
    expect(loaded.feedbackCount).toBe(15);
    expect(loaded.likes).toEqual(['AI']);
  });

  // ----------------------------------------
  // tryUpdateUserProfile: 冷却期
  // ----------------------------------------

  it('should enforce cooldown on tryUpdateUserProfile', async () => {
    // 第一次成功
    const result1 = await tryUpdateUserProfile('like', '量子计算', '主人喜欢量子计算');
    expect(result1.success).toBe(true);

    // 立即第二次被拒绝
    const result2 = await tryUpdateUserProfile('like', 'AI', '主人也喜欢AI');
    expect(result2.success).toBe(false);
    expect(result2.reason).toContain('冷却');
  });

  it('should not enforce cooldown on first call', async () => {
    const result = await tryUpdateUserProfile('like', '深度学习', '主人对AI感兴趣');
    expect(result.success).toBe(true);
    const profile = result.profile!;
    // S1：likes/dislikes 消解——Agent 观察只计样本
    expect(profile.likes).toEqual([]);
    expect(profile.sampleCount).toBe(1);
  });

  // ----------------------------------------
  // Zod schema: 正常数据
  // ----------------------------------------

  it('UserProfileSchema should parse valid data', () => {
    const valid = {
      likes: ['AI', '科技'],
      dislikes: ['广告'],
      lastUpdated: new Date().toISOString(),
      feedbackCount: 3,
      sampleCount: 10,
      confidence: 0.5,
      lastProfileUpdateAt: new Date().toISOString(),
    };
    const result = UserProfileSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('UserProfileSchema should reject missing fields', () => {
    const invalid = { likes: ['AI'] };
    const result = UserProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('UserProfileSchema should reject invalid confidence range', () => {
    const valid = {
      likes: [],
      dislikes: [],
      lastUpdated: new Date().toISOString(),
      feedbackCount: 0,
      sampleCount: 0,
      confidence: 1.5, // 超出 0-1
      lastProfileUpdateAt: null,
    };
    const result = UserProfileSchema.safeParse(valid);
    expect(result.success).toBe(false);
  });
});
