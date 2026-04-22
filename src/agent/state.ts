import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { AgentState, Mood } from '../types';
import { getDataPath } from '../config';
import { consola } from '../logger';

/**
 * 默认初始状态
 */
function createDefaultState(): AgentState {
  return {
    // 基础状态
    boredom: 30,
    energy: 80,
    mood: 'curious',

    // 个性参数
    temper: 20,
    stubbornness: 30,

    // 记忆
    lastAction: null,
    lastActionTime: null,
    lastHuntResult: null,
    recentTopics: [],
    userLikes: [],
    userDislikes: [],

    // 统计
    totalHunts: 0,
    totalPushes: 0,
    consecutiveFailures: 0,

    // 时间感知
    lastHeartbeat: new Date().toISOString(),
    lastHunt: null,
    lastRest: null,
  };
}

/**
 * 解析 MD 文件中的状态
 * 格式见 docs/mvp-plan.md
 */
function parseStateMarkdown(content: string): AgentState {
  const defaultState = createDefaultState();
  
  try {
    // 简单的键值解析
    const lines = content.split('\n');
    const result = { ...defaultState };
    
    for (const line of lines) {
      const match = line.match(/-\s*(.+?)[:：]\s*(.+)/);
      if (!match) continue;
      
      const [, key, value] = match;
      if (!key || !value) continue;
      
      const normalizedKey = key.trim().toLowerCase();
      const normalizedValue = value.trim();
      
      // 解析数值
      if (normalizedKey.includes('无聊')) {
        const numMatch = normalizedValue.match(/(\d+)/);
        if (numMatch?.[1]) result.boredom = parseInt(numMatch[1], 10);
      }
      else if (normalizedKey.includes('精力')) {
        const numMatch = normalizedValue.match(/(\d+)/);
        if (numMatch?.[1]) result.energy = parseInt(numMatch[1], 10);
      }
      else if (normalizedKey.includes('心情')) {
        const moodMap: Record<string, Mood> = {
          '好奇': 'curious',
          'curious': 'curious',
          '暴躁': 'grumpy',
          'grumpy': 'grumpy',
          '调皮': 'playful',
          'playful': 'playful',
          '懒散': 'lazy',
          'lazy': 'lazy',
          '兴奋': 'excited',
          'excited': 'excited',
          'emo': 'emo',
        };
        const mood = moodMap[normalizedValue.toLowerCase()];
        if (mood) result.mood = mood;
      }
      else if (normalizedKey.includes('脾气')) {
        const numMatch = normalizedValue.match(/(\d+)/);
        if (numMatch?.[1]) result.temper = parseInt(numMatch[1], 10);
      }
      else if (normalizedKey.includes('总狩猎')) {
        const numMatch = normalizedValue.match(/(\d+)/);
        if (numMatch?.[1]) result.totalHunts = parseInt(numMatch[1], 10);
      }
      else if (normalizedKey.includes('总推送')) {
        const numMatch = normalizedValue.match(/(\d+)/);
        if (numMatch?.[1]) result.totalPushes = parseInt(numMatch[1], 10);
      }
    }
    
    return result;
  } catch (error) {
    consola.error('解析状态文件失败，使用默认状态:', error);
    return defaultState;
  }
}

/**
 * 将状态序列化为 Markdown
 */
function serializeStateMarkdown(state: AgentState): string {
  const moodNames: Record<Mood, string> = {
    curious: '好奇',
    grumpy: '暴躁',
    playful: '调皮',
    lazy: '懒散',
    excited: '兴奋',
    emo: 'emo',
  };

  return `# Agent 状态

## 情绪
- 无聊值: ${state.boredom}/100
- 精力值: ${state.energy}/100
- 心情: ${moodNames[state.mood]}
- 脾气值: ${state.temper}/100

## 行为
- 上次行动: ${state.lastAction || '无'}
- 上次狩猎结果: ${state.lastHuntResult || '无'}
- 连续失败: ${state.consecutiveFailures} 次

## 记忆
- 最近话题: ${state.recentTopics.slice(-5).join(', ') || '无'}
- 用户喜欢: ${state.userLikes.slice(-5).join(', ') || '无'}
- 用户讨厌: ${state.userDislikes.slice(-5).join(', ') || '无'}

## 统计
- 总狩猎: ${state.totalHunts} 次
- 总推送: ${state.totalPushes} 次

## 时间
- 上次心跳: ${state.lastHeartbeat}
- 上次狩猎: ${state.lastHunt || '无'}
- 上次休息: ${state.lastRest || '无'}
`;
}

/**
 * 加载 Agent 状态
 */
export async function loadState(): Promise<AgentState> {
  const statePath = getDataPath('state.md');
  
  // 文件不存在则创建默认状态
  if (!existsSync(statePath)) {
    const defaultState = createDefaultState();
    await saveState(defaultState);
    return defaultState;
  }
  
  const content = await readFile(statePath, 'utf-8');
  return parseStateMarkdown(content);
}

/**
 * 保存 Agent 状态
 */
export async function saveState(state: AgentState): Promise<void> {
  const statePath = getDataPath('state.md');
  const content = serializeStateMarkdown(state);
  await writeFile(statePath, content, 'utf-8');
}

/**
 * 更新状态（部分更新）
 */
export async function updateState(
  updates: Partial<AgentState>
): Promise<AgentState> {
  const state = await loadState();
  const newState = { ...state, ...updates };
  await saveState(newState);
  return newState;
}

/**
 * 心跳：更新无聊值和精力值
 */
export async function heartbeat(
  boredomGrowth: number,
  energyRecovery: number
): Promise<AgentState> {
  const state = await loadState();
  
  const newBoredom = Math.min(100, state.boredom + boredomGrowth);
  const newEnergy = Math.min(100, state.energy + energyRecovery);
  
  // 脾气值随时间缓慢衰减
  const newTemper = Math.max(0, state.temper - 1);
  
  const newState = await updateState({
    boredom: newBoredom,
    energy: newEnergy,
    temper: newTemper,
    lastHeartbeat: new Date().toISOString(),
  });
  
  return newState;
}

/**
 * 记录用户反馈
 */
export async function recordFeedback(
  type: 'like' | 'dislike',
  topic: string
): Promise<AgentState> {
  const state = await loadState();
  
  const updates: Partial<AgentState> = {};
  
  if (type === 'like') {
    updates.userLikes = [...state.userLikes, topic].slice(-20);
    updates.temper = Math.max(0, state.temper - 10);
    
    // 连续点赞可能改善心情
    if (state.temper < 30) {
      updates.mood = 'excited';
    }
  } else {
    updates.userDislikes = [...state.userDislikes, topic].slice(-20);
    updates.temper = Math.min(100, state.temper + 15);
    
    // 被踩太多可能变 emo
    if (state.temper > 70) {
      updates.mood = 'grumpy';
    }
    if (state.temper > 90) {
      updates.mood = 'emo';
    }
  }
  
  return updateState(updates);
}