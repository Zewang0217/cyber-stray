/**
 * FeedbackPipeline 测试
 *
 * 覆盖：registerSpeakTopics 消息-兴趣映射、processFeedback 完整链路
 * （画像更新 + 兴趣加权）、映射容量控制、解耦失败不阻断。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'fs/promises';
import {
  processFeedback,
  boostTopic,
  registerSpeakTopics,
  getMessageTopicMapSize,
  _clearMessageTopicMap,
} from './feedback-pipeline.js';
import { getInterestGraph, _resetInterestGraphCache } from './interest-graph.js';
import { loadUserProfile, saveUserProfile } from './user-profile.js';
import { useTempDataDir } from '../test/helpers.js';

describe('FeedbackPipeline', () => {
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    cleanup = temp.cleanup;
    _clearMessageTopicMap();
    _resetInterestGraphCache();
  });

  afterEach(() => {
    cleanup();
  });

  // ----------------------------------------
  // registerSpeakTopics
  // ----------------------------------------

  it('should register message-topic mapping', () => {
    registerSpeakTopics('msg-001', ['量子计算', 'AI', '科技']);
    expect(getMessageTopicMapSize()).toBe(1);

    // 二次注册同一 messageId 覆盖
    registerSpeakTopics('msg-001', ['深度学习']);
    expect(getMessageTopicMapSize()).toBe(1);
  });

  it('should ignore empty topics', () => {
    registerSpeakTopics('msg-002', []);
    expect(getMessageTopicMapSize()).toBe(0);
  });

  it('should ignore empty messageId', () => {
    registerSpeakTopics('', ['AI']);
    expect(getMessageTopicMapSize()).toBe(0);
  });

  // ----------------------------------------
  // processFeedback: 无映射退化
  // ----------------------------------------

  it('should record feedback even without topic mapping', async () => {
    const result = await processFeedback('like', 'unknown-msg', 'user-1');
    expect(result.recorded).toBe(true);
    expect(result.topicsMatched).toBe(false);
    expect(result.profileUpdated).toBe(false);
    expect(result.interestReinforced).toBe(false);
  });

  // ----------------------------------------
  // processFeedback: like → 画像 + 兴趣加权
  // ----------------------------------------

  it('should update profile and reinforce interest on like', async () => {
    // 先初始化 InterestGraph（添加一个种子兴趣）
    await mkdir('data', { recursive: true });
    const graph = getInterestGraph();
    graph.addInterest('量子计算', 0.3);

    // 注册消息-兴趣映射
    registerSpeakTopics('msg-like-1', ['量子计算']);

    // 处理点赞反馈
    const result = await processFeedback('like', 'msg-like-1', 'user-1');
    expect(result.recorded).toBe(true);
    expect(result.topicsMatched).toBe(true);
    expect(result.matchedTopics).toEqual(['量子计算']);
    expect(result.profileUpdated).toBe(true);
    expect(result.interestReinforced).toBe(true);

    // 验证画像
    const profile = await loadUserProfile();
    expect(profile.likes).toContain('量子计算');
    expect(profile.sampleCount).toBe(1);

    // 验证兴趣权重增加
    const node = graph.getNode('量子计算');
    expect(node).toBeDefined();
    expect(node!.weight).toBeGreaterThan(0.3); // 被强化了
    expect(node!.source).toBe('default'); // 原本是 default 种子
  });

  // ----------------------------------------
  // processFeedback: dislike → 画像 + 兴趣衰减
  // ----------------------------------------

  it('should update profile and decay interest on dislike', async () => {
    await mkdir('data', { recursive: true });
    const graph = getInterestGraph();
    graph.addInterest('广告', 0.5);

    registerSpeakTopics('msg-dislike-1', ['广告']);

    const result = await processFeedback('dislike', 'msg-dislike-1', 'user-1');
    expect(result.topicsMatched).toBe(true);
    expect(result.profileUpdated).toBe(true);

    // 验证画像
    const profile = await loadUserProfile();
    expect(profile.dislikes).toContain('广告');

    // 验证兴趣衰减
    const node = graph.getNode('广告');
    expect(node!.weight).toBeLessThan(0.5);
  });

  // ----------------------------------------
  // processFeedback: like 时兴趣不存在 → 自动创建
  // ----------------------------------------

  it('should auto-create interest node on like if not exists', async () => {
    await mkdir('data', { recursive: true });
    // 确保 graph 存在但无 "深度学习" 节点
    const graph = getInterestGraph();
    graph.addInterest('AI', 0.5);

    registerSpeakTopics('msg-new-topic', ['深度学习']);

    await processFeedback('like', 'msg-new-topic', 'user-1');

    // 兴趣应被自动创建
    const node = graph.getNode('深度学习');
    expect(node).toBeDefined();
    expect(node!.source).toBe('feedback'); // 来源为 feedback
    expect(node!.weight).toBeGreaterThan(0);
  });

  // ----------------------------------------
  // processFeedback: 映射消费后不移除（可能多次反馈）
  // ----------------------------------------

  it('should keep topic mapping after processing', async () => {
    await mkdir('data', { recursive: true });
    const graph = getInterestGraph();
    graph.addInterest('AI', 0.5);

    registerSpeakTopics('msg-reuse', ['AI']);

    // 第一次反馈
    await processFeedback('like', 'msg-reuse', 'user-1');
    expect(getMessageTopicMapSize()).toBe(1);

    // 第二次反馈（同一条消息可能被多次点赞/取消再点赞）
    await processFeedback('like', 'msg-reuse', 'user-2');
    expect(getMessageTopicMapSize()).toBe(1); // 映射保留
  });

  // ----------------------------------------
  // processFeedback: 各环节失败不阻断整体
  // ----------------------------------------

  it('should not throw even when InterestGraph starts empty', async () => {
    registerSpeakTopics('msg-no-graph', ['AI']);

    // InterestGraph 单例总是可用的，只是空图谱亦可操作
    const result = await processFeedback('like', 'msg-no-graph', 'user-1');
    // 记录反馈成功
    expect(result.recorded).toBe(true);
    // 整体不抛错（即使 interestReinforced 可能为 true，因为会自动创建）
    expect(result.interestReinforced).toBe(true);
  });

  // ----------------------------------------
  // 映射容量控制
  // ----------------------------------------

  it('should evict oldest entry when map exceeds capacity', () => {
    // 填满 200 条映射
    for (let i = 0; i < 250; i++) {
      registerSpeakTopics(`msg-${i}`, ['AI']);
    }
    // 不超过容量上限
    expect(getMessageTopicMapSize()).toBeLessThanOrEqual(200);
  });

  // ----------------------------------------
  // 03-03: 置信度校准 — 小样本不致锁死方向
  // ----------------------------------------

  it('should keep confidence moderate with small sample count', async () => {
    // 3 次点赞同一话题
    registerSpeakTopics('msg-conf-1', ['量子计算']);
    await processFeedback('like', 'msg-conf-1', 'user-1');
    registerSpeakTopics('msg-conf-2', ['量子计算']);
    await processFeedback('like', 'msg-conf-2', 'user-1');
    registerSpeakTopics('msg-conf-3', ['量子计算']);
    await processFeedback('like', 'msg-conf-3', 'user-1');

    const profile = await loadUserProfile();
    expect(profile.sampleCount).toBe(3);
    // sigmoid: 3/(3+10) ≈ 0.23 — 远低于旧公式的 3/20=0.15... 但关键是稳而非高
    expect(profile.confidence).toBeCloseTo(3 / 13, 1);
    // 置信度远低于 0.5，不会锁死早期方向
    expect(profile.confidence).toBeLessThan(0.5);
  });

  it('should asymptotically approach cap with large sample count', async () => {
    // 直接构造高 sampleCount 画像
    const profile = await loadUserProfile();
    profile.sampleCount = 90; // 90/(90+10) = 0.9
    await saveUserProfile(profile);

    // 再追加 1 次反馈触发 re-compute
    registerSpeakTopics('msg-high', ['AI']);
    await processFeedback('like', 'msg-high', 'user-1');

    const updated = await loadUserProfile();
    expect(updated.sampleCount).toBe(91);
    expect(updated.confidence).toBeCloseTo(91 / 101, 1);
    expect(updated.confidence).toBeLessThanOrEqual(0.95); // 受 CAP 限制
  });

  // ----------------------------------------
  // 03-03: 探索预算 — favorite 不锁死新兴趣
  // ----------------------------------------

  it('should allow new interest exploration even with high-weighted favorites', async () => {
    await mkdir('data', { recursive: true });
    const graph = getInterestGraph();

    // 多次点赞一个兴趣使其权重接近上限
    graph.addInterest('量子计算', 0.5);
    for (let i = 0; i < 5; i++) {
      await mkdir('data/memory', { recursive: true });
      registerSpeakTopics(`msg-explore-${i}`, ['量子计算']);
      await processFeedback('like', `msg-explore-${i}`, 'user-1');
    }

    // 即使 "量子计算" 权重很高，仍能添加新兴趣（novelty 预算生效）
    const added = graph.addInterest('音乐', 0.2);
    // novelty 预算应允许新兴趣加入（除非总有效权重超出 1.0 + noveltyBudget）
    expect(added).toBe(true);

    // 验证新兴趣已添加
    expect(graph.getNode('音乐')).toBeDefined();
  });

  it('should allow adding new interest even after many likes on one topic', async () => {
    await mkdir('data', { recursive: true });
    const graph = getInterestGraph();

    // 构造场景：多次点赞同一兴趣
    graph.addInterest('AI', 0.3);
    for (let i = 0; i < 10; i++) {
      registerSpeakTopics(`msg-bias-${i}`, ['AI']);
      await processFeedback('like', `msg-bias-${i}`, 'user-1');
    }

    // 用户画像的 confidence 是 sigmoid 的，不应锁死
    const profile = await loadUserProfile();
    // 10 次样本 → 10/20 = 0.5，仍在可控范围
    expect(profile.confidence).toBeLessThan(0.6);

    // 兴趣图谱中仍能添加新兴趣
    const addedNew = graph.addInterest('生物学', 0.2);
    expect(addedNew).toBe(true);
  });
});

describe('S9 REST 反馈（持久化归因 + boost）', () => {
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    cleanup = temp.cleanup;
    _clearMessageTopicMap();
    _resetInterestGraphCache();
  });

  afterEach(() => {
    cleanup();
  });
  // ----------------------------------------
  // S9 (#76)：REST 反馈 + 顶话题
  // ----------------------------------------

  it('opts.topics 显式归因：无内存映射也能强化兴趣（worker 短命进程场景）', async () => {
      await mkdir('data/memory', { recursive: true });
      const graph = getInterestGraph();
      graph.addInterest('量子计算', 0.3);
      const before = graph.getNode('量子计算')!.weight;

      // 不注册内存映射——归因来自 speaks 历史反查（调用方解析）
      const result = await processFeedback('like', 'om-rest-1', 'user-1', {
        topics: ['量子计算'],
      });

      expect(result.recorded).toBe(true);
      expect(result.topicsMatched).toBe(true);
      expect(result.interestReinforced).toBe(true);
      expect(graph.getNode('量子计算')!.weight).toBeGreaterThan(before);
    });

    it('boostTopic：新话题入图（source=feedback）+ 权重高于点赞强化', async () => {
      await mkdir('data/memory', { recursive: true });
      const graph = getInterestGraph();

      const result = await boostTopic('天文摄影', 'user-1');

      expect(result.recorded).toBe(true);
      expect(result.interestReinforced).toBe(true);
      const node = graph.getNode('天文摄影');
      expect(node).toBeDefined();
      expect(node!.source).toBe('feedback');
      // 0.3 种子 + 0.25 强化，明显高于单次点赞的 +0.1
      expect(node!.weight).toBeGreaterThanOrEqual(0.55);
    });

    it('boostTopic：已有话题只强化不重建，反馈记录 type=boost', async () => {
      await mkdir('data/memory', { recursive: true });
      const graph = getInterestGraph();
      graph.addInterest('量子计算', 0.5);
      const before = graph.getNode('量子计算')!.weight;

      await boostTopic('量子计算', 'user-1');

      expect(graph.getNode('量子计算')!.weight).toBeGreaterThan(before);

      const { readFile } = await import('fs/promises');
      const { getDataPath } = await import('../config.js');
      const store = JSON.parse(await readFile(getDataPath('feedback.json'), 'utf-8')) as {
        feedbacks: Array<{ type: string }>;
      };
      expect(store.feedbacks.some((f) => f.type === 'boost')).toBe(true);
    });
});
