/**
 * 日记生成器（#92）——输入 → 性格化叙述 markdown
 *
 * 内容源全部是现有数据（零新采集）：
 * - 游荡足迹：wander-history.json 当天步骤
 * - 新兴趣/强化：当天 interest-history.jsonl 快照出现的节点
 * - 主人互动反馈：feedback.json 当天的 like/dislike/boost
 *
 * 纯函数层（可测）：buildDiaryPrompt（事实+性格模板 → LLM prompt）、
 * renderDiaryMarkdown（叙述 → 落盘 markdown 结构）。
 * I/O 层：collectDiaryData / writeDiaryMarkdown（走 getDataPath，租户隔离）。
 * LLM 层：generateDiaryNarrative（AI SDK generateText，模型由调用方注入）。
 *
 * 风格：风格选择来自注册表（personality.diaryStyle，默认随性格），
 * 用户可配具体风格覆盖（shared/diary.ts 的 DIARY_STYLE_PROMPTS）。
 * 每个内容段"有则写、无则跳过"；三段全空 = 今天无事可记，跳过生成。
 */

import { generateText } from 'ai';
import { sanitizeForLLM } from '../../utils/text-sanitize.js';
import { readFile, mkdir, appendFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getDataPath } from '../../config.js';
import { loadFeedbacks } from '../feedback-store.js';
import type { PersonalityProfile } from '@cyber-stray/shared';
import { resolveDiaryStylePrompt } from '@cyber-stray/shared/diary';
import type { DiaryStyleChoice } from '@cyber-stray/shared/diary';
import { deriveTitle } from '../../tools/push/history-record.js';
import { todaySpeaksFile } from '../../tools/push/push-budget.js';

/** 日记落盘目录（租户隔离的 markdown 契约：diary/YYYY-MM-DD.md） */
export const DIARY_DIR = 'diary';

/** 单条游荡足迹（wander-history.json 的步骤子集） */
export interface DiaryFootprintItem {
  tool: string;
  thought?: string;
  url?: string;
  spoke?: boolean;
  timestamp?: string;
}

/** 日记生成输入（已从各数据源收集好的当天事实） */
export interface DiaryData {
  /** 日期（YYYY-MM-DD，与文件名对齐） */
  date: string;
  petName: string;
  footprint: DiaryFootprintItem[];
  interests: string[];
  feedback: string[];
}

/** 日记文件名：diary/YYYY-MM-DD.md */
export function diaryFilePath(date: string): string {
  return getDataPath(join(DIARY_DIR, `${date}.md`));
}

/** 是否今天无事可记（三段全空 → 跳过生成） */
export function hasDiaryContent(data: DiaryData): boolean {
  return (
    data.footprint.length > 0 || data.interests.length > 0 || data.feedback.length > 0
  );
}

/** 收集当天日记素材（租户上下文/DATA_DIR 已就绪时调用；缺失 = 合法空态） */
export async function collectDiaryData(date: string, petName: string): Promise<DiaryData> {
  const footprint = await collectTodayFootprint(date);
  const interests = await collectTodayInterests(date);
  const feedback = await collectTodayFeedback(date);
  return { date, petName, footprint, interests, feedback };
}

/** 读 wander-history.json，取 timestamp 落在当天的步骤（缺失 = 空数组） */
async function collectTodayFootprint(date: string): Promise<DiaryFootprintItem[]> {
  const path = getDataPath('wander-history.json');
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return [];
  }
  let steps: unknown;
  try {
    steps = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(steps)) return [];
  return steps.filter((s): s is DiaryFootprintItem => {
    const ts = (s as { timestamp?: unknown }).timestamp;
    return typeof ts === 'string' && ts.slice(0, 10) === date;
  });
}

/** 读当天 interest-history.jsonl 快照，去重取当天出现的兴趣节点 id（缺失 = 空） */
async function collectTodayInterests(date: string): Promise<string[]> {
  const path = getDataPath('interest-history.jsonl');
  if (!existsSync(path)) return [];
  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const line of content.split('\n').filter(Boolean)) {
    let snap: { timestamp?: unknown; nodes?: Array<{ id?: unknown }> };
    try {
      snap = JSON.parse(line) as { timestamp?: unknown; nodes?: Array<{ id?: unknown }> };
    } catch {
      continue;
    }
    if (typeof snap.timestamp !== 'string' || snap.timestamp.slice(0, 10) !== date) continue;
    for (const node of snap.nodes ?? []) {
      if (typeof node.id === 'string' && node.id.length > 0) ids.add(node.id);
    }
  }
  return [...ids];
}

/** 读 feedback.json，取当天的 like/dislike/boost（缺失 = 空） */
async function collectTodayFeedback(date: string): Promise<string[]> {
  let feedbacks;
  try {
    feedbacks = await loadFeedbacks();
  } catch {
    return [];
  }
  const labels: Record<string, string> = {
    like: '赞了',
    dislike: '踩了',
    boost: '顶了话题',
  };
  return feedbacks
    .filter((f) => f.timestamp.slice(0, 10) === date)
    .map((f) => `${labels[f.type] ?? f.type}${f.messageId ? `（${f.messageId}）` : ''}`);
}

/**
 * 构建日记生成 prompt（纯函数）。
 * 风格 = resolveDiaryStylePrompt(styleChoice, personality.diaryStyle)：
 * 'personality' 用性格模板，具体风格用 DIARY_STYLE_PROMPTS。
 * 有则写无则跳过：各段只在有内容时进入 prompt。
 */
export function buildDiaryPrompt(
  data: DiaryData,
  personality: PersonalityProfile,
  styleChoice: DiaryStyleChoice,
): string {
  const stylePrompt = resolveDiaryStylePrompt(styleChoice, personality.diaryStyle);

  const sections: string[] = [
    `你是${data.petName}，一只${personality.name}性格的赛博宠物。今天（${data.date}）要写一篇日记。`,
    `性格写照：${personality.description}`,
    `日记风格：${stylePrompt}`,
  ];

  if (data.footprint.length > 0) {
    const items = data.footprint
      .slice(0, 20)
      .map((s) => {
        const where = s.url ? `（看了 ${s.url}）` : '';
        const what = s.thought ? `：${s.thought.slice(0, 120)}` : '';
        return `- ${s.tool}${where}${what}`;
      })
      .join('\n');
    sections.push(`## 今天游荡足迹\n${items}`);
  }

  if (data.interests.length > 0) {
    sections.push(`## 今天在意的兴趣\n${data.interests.slice(0, 10).map((t) => `- ${t}`).join('\n')}`);
  }

  if (data.feedback.length > 0) {
    sections.push(`## 主人今天给我的反馈\n${data.feedback.map((f) => `- ${f}`).join('\n')}`);
  }

  sections.push(
    '请用第一人称写一篇 150–300 字的日记，把我今天游荡的经历、在意的兴趣、和主人的互动自然讲出来。' +
      '用 markdown 输出（可带小标题），语气符合我的性格与日记风格。',
  );

  return sections.join('\n\n');
}

/** 渲染最终落盘 markdown（纯函数）：标题 + 元信息头 + LLM 叙述 */
export function renderDiaryMarkdown(
  narrative: string,
  meta: { date: string; petName: string; personalityName: string; styleLabel: string },
): string {
  const body = narrative.trim();
  return [
    `# 日记 · ${meta.date}`,
    '',
    `**${meta.petName}** · 性格：${meta.personalityName} · 风格：${meta.styleLabel}`,
    '',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** 落盘日记 markdown（原子写：tmp + rename） */
export async function writeDiaryMarkdown(date: string, content: string): Promise<string> {
  const fullPath = diaryFilePath(date);
  await mkdir(getDataPath(DIARY_DIR), { recursive: true });
  const tmp = `${fullPath}.tmp`;
  await writeFileAtomic(tmp, fullPath, content);
  return fullPath;
}

/** 原子写（tmp + rename；#93 梦境复用同一实现，故导出） */
export async function writeFileAtomic(tmp: string, dest: string, content: string): Promise<void> {
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, dest);
}

/**
 * 若日记推送开启，把日记写进 speaks 历史（notifiable 记录，pushed=false），
 * 供控制面 Web Push（latestNotifiableSpeak）在 diary_generated 事件后送达。
 * 复用 buildSpeakRecord 派生标题/摘要。失败显式抛（禁兜底）。
 * 时间戳 = 实际生成时刻（保证最新可通知、去重时序正确）。
 */
export async function recordDiaryForPush(content: string): Promise<{ title: string; file: string }> {
  const title = deriveTitle(content, 'article');
  const historyDir = getDataPath('history');
  await mkdir(historyDir, { recursive: true });
  const file = join(historyDir, todaySpeaksFile());
  const record = {
    content,
    type: 'article',
    pushed: false,
    timestamp: new Date().toISOString(),
    title,
    gated: false,
    planLimited: false,
    diary: true,
  };
  await appendFile(file, JSON.stringify(record) + '\n', 'utf-8');
  return { title, file };
}

/** 生成日记叙述（AI SDK generateText；模型由调用方注入，测试可 mock） */
export async function generateDiaryNarrative(
  prompt: string,
  model: Parameters<typeof generateText>[0]['model'],
  temperature: number,
): Promise<string> {
  const result = await generateText({ model, temperature, prompt: sanitizeForLLM(prompt) });
  return result.text;
}
