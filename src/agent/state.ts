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

    // Agent 个性化（ReAct 架构）
    agentInterests: ['科技', 'AI', '互联网'],

    // 统计
    totalHunts: 0,
    totalWanders: 0,
    totalSteps: 0,
    totalPushes: 0,
    consecutiveFailures: 0,

    // 时间感知
    lastHeartbeat: new Date().toISOString(),
    lastHunt: null,
    lastWander: null,
    lastRest: null,
  };
}

/**
 * 解析 JSON 文件中的状态
 */
function parseStateJson(content: string): AgentState {
  const defaultState = createDefaultState();
  
  try {
    const parsed = JSON.parse(content) as Partial<AgentState>;
    return { ...defaultState, ...parsed };
  } catch (error) {
    consola.error('解析状态文件失败，使用默认状态:', error);
    return defaultState;
  }
}

/**
 * 将状态序列化为 JSON
 */
function serializeStateJson(state: AgentState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * 加载 Agent 状态
 */
export async function loadState(): Promise<AgentState> {
  const statePath = getDataPath('state.json');
  
  if (!existsSync(statePath)) {
    const defaultState = createDefaultState();
    await saveState(defaultState);
    return defaultState;
  }
  
  const content = await readFile(statePath, 'utf-8');
  return parseStateJson(content);
}

/**
 * 保存 Agent 状态
 */
export async function saveState(state: AgentState): Promise<void> {
  const statePath = getDataPath('state.json');
  const content = serializeStateJson(state);
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