/**
 * FeedbackPipeline 测试
 *
 * 覆盖：registerSpeakTopics 消息-兴趣映射、processFeedback 完整链路
 * （画像更�?+ 兴趣加权）、映射容量控制、解耦失败不阻断�?
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'fs/promises';
import {
  processFeedback,
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
  // processFeedback: 无映射退�?
  // ----------------------------------------

  it('should record feedback even without topic mapping', async () => {
    const result = await processFeedback('like', 'unknown-msg', 'user-1');
    expect(result.recorded).toBe(true);
    expect(result.topicsMatched).toBe(false);
    expect(result.profileUpdated).toBe(false);
    expect(result.interestReinforced).toBe(false);
  });

  // ----------------------------------------
  // processFeedback: like �?画像 + 兴趣加权
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
    expect(node!.source).toBe('default'); // 原本�?default 种子
  });

  // ----------------------------------------
  // processFeedback: dislike �?画像 + 兴趣衰减
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
  // processFeedback: like 时兴趣不存在 �?自动创建
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
    expect(node!.source).toBe('feedback'); // 来源�?feedback
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

    // 第一次反�?
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

    // InterestGraph 单例总是可用的，只是空图谱亦可操�?
    const result = await processFeedback('like', 'msg-no-graph', 'user-1');
    // 记录反馈成功
    expect(result.recorded).toBe(true);
    // 整体不抛错（即使 interestReinforced 可能�?true，因为会自动创建�?
    expect(result.interestReinforced).toBe(true);
  });

  // ----------------------------------------
  // 映射容量控制
  // ----------------------------------------

  it('should evict oldest entry when map exceeds capacity', () => {
    // 填满 200 条映�?
    for (let i = 0; i < 250; i++) {
      registerSpeakTopics(`msg-${i}`, ['AI']);
    }
    // 不超过容量上�?
    expect(getMessageTopicMapSize()).toBeLessThanOrEqual(200);
  });

  // ----------------------------------------
  // 03-03: 置信度校�?�?小样本不致锁死方�?
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
    // sigmoid: 3/(3+10) �?0.23 �?远低于旧公式�?3/20=0.15... 但关键是稳而非�?
    expect(profile.confidence).toBeCloseTo(3 / 13, 1);
    // 置信度远低于 0.5，不会锁死早期方�?
    expect(profile.confidence).toBeLessThan(0.5);
  });

  it('should asymptotically approach cap with large sample count', async () => {
    // 直接构造高 sampleCount 画像
    const profile = await loadUserProfile();
    profile.sampleCount = 90; // 90/(90+10) = 0.9
    await saveUserProfile(profile);

    // 再追�?1 次反馈触�?re-compute
    registerSpeakTopics('msg-high', ['AI']);
    await processFeedback('like', 'msg-high', 'user-1');

    const updated = await loadUserProfile();
    expect(updated.sampleCount).toBe(91);
    expect(updated.confidence).toBeCloseTo(91 / 101, 1);
    expect(updated.confidence).toBeLessThanOrEqual(0.95); // �?CAP 限制
  });

  // ----------------------------------------
  // 03-03: 探索预算 �?favorite 不锁死新兴趣
  // ----------------------------------------

  it('should allow new interest exploration even with high-weighted favorites', async () => {
    await mkdir('data', { recursive: true });
    const graph = getInterestGraph();

    // 多次点赞一个兴趣使其权重接近上�?
    graph.addInterest('量子计算', 0.5);
    for (let i = 0; i < 5; i++) {
      await mkdir('data/memory', { recursive: true });
      registerSpeakTopics(`msg-explore-${i}`, ['量子计算']);
      await processFeedback('like', `msg-explore-${i}`, 'user-1');
    }

    // 即使 "量子计算" 权重很高，仍能添加新兴趣（novelty 预算生效�?
    const added = graph.addInterest('音乐', 0.2);
    // novelty 预算应允许新兴趣加入（除非总有效权重超�?1.0 + noveltyBudget�?
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

    // 用户画像�?confidence �?sigmoid 的，不应锁死
    const profile = await loadUserProfile();
    // 10 次样�?�?10/20 = 0.5，仍在可控范�?
    expect(profile.confidence).toBeLessThan(0.6);

    // 兴趣图谱中仍能添加新兴趣
    const addedNew = graph.addInterest('生物�?, 0.2);
    expect(addedNew).toBe(true);
  });
});
