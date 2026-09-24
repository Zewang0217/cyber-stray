/**
 * 运营与进化证据快照（#299，中期答辩证据管线）
 *
 * 每租户聚合五路只读数据 → 单份快照（JSON + Markdown）：
 *   活跃/回访（activity JSONL，#302）· X1 判定（x1.ts）· 反馈（feedback.json）
 *   推送漏斗（history/speaks-*.jsonl）· 用量（usage JSONL）· 兴趣轨迹（interest-history.jsonl）
 *
 * 只读生产数据，不写租户目录；报告落 <dataDir>/snapshot-report.json。
 * 证据纪律：每个数字可溯源（读数函数即来源）；坏行跳过不拖垮报告，
 * 结构性损坏抛错进租户级 error（同 x1-report 惯例）。
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { InterestSnapshot } from '@cyber-stray/shared/interest-graph';
import { readTenantUsage } from '../infra/usage.js';
import { readTenantActivityDays } from '../infra/tenant-activity.js';
import { tenantDataDir } from '../infra/tenant.js';
import { computeX1, type X1Result } from './x1.js';

const HISTORY_DIR = 'history';
const SPEAKS_FILE_RE = /^speaks-\d{4}-\d{2}-\d{2}\.jsonl$/;

/** 推送漏斗计数（speaks 行按需字段） */
export interface SpeakFunnel {
  /** speak 总次数（含被门控拦截） */
  total: number;
  /** 实际推送（pushed=true） */
  pushed: number;
  /** 被门控拦截（gated=true） */
  gated: number;
  /** 首末推送日（本地日期键；无推送 = null） */
  firstDay: string | null;
  lastDay: string | null;
}

/** 反馈分型计数 */
export interface FeedbackBreakdown {
  total: number;
  like: number;
  dislike: number;
  boost: number;
}

/** 兴趣轨迹两端（进化证据的核心两点） */
export interface InterestTrajectory {
  /** 快照条数（=图谱有记录的变更点数） */
  snapshots: number;
  first: { day: string; entropy: number; nodeCount: number } | null;
  last: { day: string; entropy: number; nodeCount: number } | null;
}

export interface TenantSnapshot {
  tenantId: string;
  status: 'ok' | 'error';
  error?: string;
  adoptedDay: string | null;
  /** 活跃日集合（本地日期键升序） */
  activityDays: string[];
  lastActiveDay: string | null;
  x1: X1Result | null;
  feedback: FeedbackBreakdown;
  speaks: SpeakFunnel;
  interest: InterestTrajectory;
  /** LLM token 用量（输入/输出累计） */
  llmInputTokens: number;
  llmOutputTokens: number;
  /** 生图/视觉质检张数 */
  imageCount: number;
}

export interface EvidenceReport {
  ranAt: string;
  tenants: TenantSnapshot[];
}

// ---------- 读数（每路一个，抛错由 gatherer 捕获为租户级 error） ----------

/** 读反馈分型计数；ENOENT = 合法空态；坏结构抛错（禁兜底） */
export async function readTenantFeedback(tenantDir: string): Promise<FeedbackBreakdown> {
  let raw: string;
  try {
    raw = await readFile(join(tenantDir, 'feedback.json'), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { total: 0, like: 0, dislike: 0, boost: 0 };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as { feedbacks?: Array<{ type?: string }> };
  if (!Array.isArray(parsed.feedbacks)) {
    throw new Error('feedback.json 结构非法：feedbacks 不是数组');
  }
  const breakdown: FeedbackBreakdown = { total: parsed.feedbacks.length, like: 0, dislike: 0, boost: 0 };
  for (const f of parsed.feedbacks) {
    if (f.type === 'like') breakdown.like += 1;
    else if (f.type === 'dislike') breakdown.dislike += 1;
    else if (f.type === 'boost') breakdown.boost += 1;
  }
  return breakdown;
}

/** 读推送漏斗（history/speaks-*.jsonl 全量）；目录不存在 = 合法空态 */
export async function readTenantSpeaks(tenantDir: string): Promise<SpeakFunnel> {
  const dir = join(tenantDir, HISTORY_DIR);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFunnel();
    throw error;
  }
  const funnel: SpeakFunnel = emptyFunnel();
  for (const file of files.filter((f) => SPEAKS_FILE_RE.test(f)).sort()) {
    const content = await readFile(join(dir, file), 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let row: { pushed?: boolean; gated?: boolean; timestamp?: string };
      try {
        row = JSON.parse(line);
      } catch {
        continue; // 半行写入跳过
      }
      funnel.total += 1;
      if (row.pushed) funnel.pushed += 1;
      if (row.gated) funnel.gated += 1;
      const day = row.timestamp?.slice(0, 10);
      if (day) {
        if (!funnel.firstDay || day < funnel.firstDay) funnel.firstDay = day;
        if (!funnel.lastDay || day > funnel.lastDay) funnel.lastDay = day;
      }
    }
  }
  return funnel;
}

function emptyFunnel(): SpeakFunnel {
  return { total: 0, pushed: 0, gated: 0, firstDay: null, lastDay: null };
}

/** 读兴趣轨迹两端（interest-history.jsonl；行自带 entropy/nodeCount） */
export async function readTenantInterestTrajectory(tenantDir: string): Promise<InterestTrajectory> {
  let raw: string;
  try {
    raw = await readFile(join(tenantDir, 'interest-history.jsonl'), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyTrajectory();
    throw error;
  }
  const snaps: InterestSnapshot[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      snaps.push(JSON.parse(line) as InterestSnapshot);
    } catch {
      continue; // 半行写入跳过
    }
  }
  if (snaps.length === 0) return emptyTrajectory();
  const first = snaps[0]!;
  const last = snaps[snaps.length - 1]!;
  const point = (s: InterestSnapshot) => ({
    day: s.timestamp.slice(0, 10),
    entropy: s.entropy,
    nodeCount: s.nodes.length,
  });
  return { snapshots: snaps.length, first: point(first), last: point(last) };
}

function emptyTrajectory(): InterestTrajectory {
  return { snapshots: 0, first: null, last: null };
}

// ---------- 聚合与渲染 ----------

/** 单租户快照收集（IO 编排；单路失败 = 租户级 error，不拖垮整报） */
export async function collectTenantSnapshot(
  dataDir: string,
  tenantId: string,
  adoptedMs: number | null,
): Promise<TenantSnapshot> {
  const tenantDir = tenantDataDir(dataDir, tenantId);
  const [activityDays, feedback, speaks, interest] = await Promise.all([
    readTenantActivityDays(tenantDir),
    readTenantFeedback(tenantDir),
    readTenantSpeaks(tenantDir),
    readTenantInterestTrajectory(tenantDir),
  ]);
  const usageRows = await readTenantUsage(dataDir, tenantId);

  const adoptedDay = adoptedMs === null ? null : toLocalDay(adoptedMs);
  const x1 =
    adoptedDay === null
      ? null
      : computeX1({ adoptedDay, activityDays, feedbackCount: feedback.total });

  return {
    tenantId,
    status: 'ok',
    adoptedDay,
    activityDays,
    lastActiveDay: activityDays.at(-1) ?? null,
    x1,
    feedback,
    speaks,
    interest,
    llmInputTokens: usageRows.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
    llmOutputTokens: usageRows.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0),
    imageCount: usageRows.reduce((sum, r) => sum + (r.images ?? 0), 0),
  };
}

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 快照的 Markdown 形态（答辩材料直接引用） */
export function renderTenantMarkdown(s: TenantSnapshot): string {
  if (s.status === 'error') return `## ${s.tenantId}\n\n读取失败：${s.error}\n`;
  const lines = [`## ${s.tenantId}`, ``, `- 领养日（D0）：${s.adoptedDay ?? '未领养'}`];
  if (s.x1) {
    lines.push(
      `- 回访：${s.activityDays.length} 个活跃日，最后活跃 ${s.lastActiveDay ?? '无'}`,
      `- X1 信念判定：${s.x1.x1 ? '✅ 成立' : '❌ 未成立'}（窗 [${s.x1.windowStart}, ${s.x1.windowEnd}]，窗内回访 ${s.x1.revisitDaysInWindow.join('、') || '无'}）`,
    );
  }
  lines.push(
    `- 反馈：共 ${s.feedback.total}（👍${s.feedback.like} / 👎${s.feedback.dislike} / 顶${s.feedback.boost}）`,
    `- 推送漏斗：speak ${s.speaks.total} 次 → 推送 ${s.speaks.pushed}，门控拦截 ${s.speaks.gated}（${s.speaks.firstDay ?? '-'} ~ ${s.speaks.lastDay ?? '-'}）`,
    `- 兴趣进化：${s.interest.snapshots} 个快照，熵 ${fmt(s.interest.first?.entropy)} → ${fmt(s.interest.last?.entropy)}，节点 ${s.interest.first?.nodeCount ?? 0} → ${s.interest.last?.nodeCount ?? 0}`,
    `- 用量：LLM 入 ${s.llmInputTokens} / 出 ${s.llmOutputTokens} tokens，生图+质检 ${s.imageCount} 张`,
  );
  return lines.join('\n');
}

function fmt(n: number | undefined): string {
  return n === undefined ? '-' : n.toFixed(3);
}
