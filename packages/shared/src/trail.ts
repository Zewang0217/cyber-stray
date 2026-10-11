/**
 * 游荡足迹视图模型（spec #389 的唯一新测试接缝）。
 *
 * 纯函数：持久化数据 → 视图模型。呈现层（web）只渲染，不重新定义契约。
 * - buildTrailView：wander-history 事件流 → 足迹地图（会话/泳道/节点/摘要）
 * - buildGraphView：记忆索引记录 + 叼回记录 → 关系图谱（节点/边）
 */

import { z } from 'zod';
import { WanderStepSchema, type WanderStepStatus } from './agent-state';

/** 足迹工具的中文标签（web 呈现层共用，禁三处平行定义） */
export const TRAIL_TOOL_LABELS: Record<string, string> = {
  search_web: '搜索',
  read_page: '阅读',
  record_knowledge: '记住',
  speak: '叼回',
  rest: '回窝',
  image_meme: '表情包',
};

/** 展示时区固定东八区（产品与主人主要时区；与 prompts/diary 的 Asia/Shanghai 一致） */
const DISPLAY_TZ = 'Asia/Shanghai';
const dayFmt = new Intl.DateTimeFormat('zh-CN', { timeZone: DISPLAY_TZ, month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('zh-CN', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit', hour12: false });

const clockFmt = new Intl.DateTimeFormat('zh-CN', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** 详情面板用的时间标签（HH:mm:ss，展示时区同会话标签） */
export function formatTrailClock(timestamp: string): string {
  return clockFmt.format(new Date(timestamp));
}

// 输入契约（持久化数据的呈现层最小子集）

/** 记忆索引记录子集（agent MemoryIndexRecord 的呈现投影） */
export const TrailMemoryRecordSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string(),
  tags: z.array(z.string()),
  summary: z.string(),
  url: z.string().optional(),
});
export type TrailMemoryRecord = z.infer<typeof TrailMemoryRecordSchema>;

/** 叼回记录子集（SpeakRecord 的呈现投影） */
export const TrailSpeakRecordSchema = z.object({
  timestamp: z.string(),
  title: z.string(),
  url: z.string().optional(),
  gated: z.boolean().optional(),
  matchedTopics: z.array(z.string()).optional(),
});
export type TrailSpeakRecord = z.infer<typeof TrailSpeakRecordSchema>;

// 足迹地图（A 视图）

/** 出现在足迹地图上的工具；browse_page 与 read_page 同语义（读了一个页面） */
const TRAIL_TOOLS: Record<string, string> = {
  search_web: 'search_web',
  read_page: 'read_page',
  browse_page: 'read_page',
  record_knowledge: 'record_knowledge',
  speak: 'speak',
  image_meme: 'image_meme',
  rest: 'rest',
};

export interface TrailEvent {
  /** 桥接匹配键：timestamp + tool（ECharts 回调 data 可能是克隆对象，禁引用匹配） */
  key: string;
  timestamp: string;
  /** 归一后的工具名（browse_page → read_page） */
  tool: string;
  alley: string;
  laneIndex: number;
  title?: string;
  thought?: string;
  url?: string;
  spoke?: string;
  status?: WanderStepStatus;
}

export interface TrailSession {
  /** 会话序号（0 = 最早） */
  index: number;
  /** MM-DD */
  day: string;
  /** HH:mm */
  time: string;
  /** 当天第几次游荡（1 起） */
  dayIndex: number;
  events: TrailEvent[];
  /** 泳道（巷子）按首次出现排序 */
  lanes: string[];
  summary: { durationMin: number; steps: number; speaks: number };
}

/** rest 固定落在「窝」泳道；无 alley 的旧数据落「无名小巷」 */
function laneOf(tool: string, alley?: string): string {
  if (tool === 'rest') return '窝';
  return alley ?? '无名小巷';
}

export function buildTrailView(rawSteps: unknown[]): TrailSession[] {
  const steps = z.array(WanderStepSchema).parse(rawSteps);
  const events = steps.flatMap((s) => {
    const tool = TRAIL_TOOLS[s.tool];
    if (!tool) return [];
    return [{
      key: `${s.timestamp}|${s.tool}`,
      timestamp: s.timestamp,
      tool,
      alley: laneOf(tool, s.alley),
      laneIndex: -1,
      ...(s.title ? { title: s.title } : {}),
      ...(s.thought ? { thought: s.thought } : {}),
      ...(s.url ? { url: s.url } : {}),
      ...(s.spoke ? { spoke: s.spoke } : {}),
      ...(s.status ? { status: s.status } : {}),
    } satisfies TrailEvent];
  });

  // rest 为会话边界；末尾无 rest 的残段（崩溃/中断）也算一个会话
  const sessions: TrailEvent[][] = [];
  let cur: TrailEvent[] = [];
  for (const e of events) {
    cur.push(e);
    if (e.tool === 'rest') {
      sessions.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) sessions.push(cur);

  const dayCount = new Map<string, number>();
  return sessions.map((evts, index) => {
    const first = evts[0];
    const last = evts[evts.length - 1];
    if (!first || !last) throw new Error('会话不含事件');
    const day = dayFmt.format(new Date(first.timestamp)).replace('/', '-'); // zh-CN 用斜杠，足迹页沿用横杠风格
    const dayIndex = (dayCount.get(day) ?? 0) + 1;
    dayCount.set(day, dayIndex);

    const lanes: string[] = [];
    for (const e of evts) {
      let li = lanes.indexOf(e.alley);
      if (li < 0) {
        lanes.push(e.alley);
        li = lanes.length - 1;
      }
      e.laneIndex = li;
    }

    const durationMin = Math.max(
      1,
      Math.round((new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 60000),
    );
    return {
      index,
      day,
      time: timeFmt.format(new Date(first.timestamp)),
      dayIndex,
      events: evts,
      lanes,
      summary: {
        durationMin,
        steps: evts.length,
        speaks: evts.filter((e) => e.tool === 'speak' && e.status !== 'blocked').length,
      },
    };
  });
}

// 关系图谱（F 视图）

export type GraphNodeKind = 'hub' | 'page' | 'memory' | 'speak';
export type GraphEdgeKind = 'contains' | 'remembered' | 'mentioned';

export interface GraphNode {
  /** 内部 id（h:/p:/m:/s: 前缀），永不进入 UI 文案 */
  id: string;
  kind: GraphNodeKind;
  /** 主题名 / 页面标题 / 记忆摘要 / 叼回标题 */
  label: string;
  url?: string;
  /** 被护栏拦截的叼回（置灰呈现） */
  gated?: boolean;
  timestamp?: string;
  /** 桥接匹配键（memory/speak 节点有，用于 F→A 回跳） */
  key?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  /** 边语义文案（tooltip 直接展示） */
  label: string;
}

const EDGE_LABELS: Record<GraphEdgeKind, string> = {
  contains: '这条内容属于这个主题',
  remembered: '它记住了这个页面里的东西',
  mentioned: '叼回时提到了这个页面',
};

/** 主题词 = tags 中去掉类型标记后的第一个（agent 侧 tags = [type, topic, ...]） */
function topicOf(tags: string[], type: string): string | undefined {
  return tags.find((t) => t !== type);
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildGraphView(rawMemories: unknown[], rawSpeaks: unknown[]): GraphView {
  const memories = z.array(TrailMemoryRecordSchema).parse(rawMemories)
    .filter((m) => m.type === 'knowledge');
  const speaks = z.array(TrailSpeakRecordSchema).parse(rawSpeaks);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();

  const hubId = (topic: string) => `h:${topic}`;
  const pageId = (url: string) => `p:${url}`;

  function ensureHub(topic: string): string {
    const id = hubId(topic);
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'hub', label: topic });
    return id;
  }

  function ensurePage(url: string, label?: string): string {
    const id = pageId(url);
    const existing = nodes.get(id);
    if (existing) {
      // 后到的更好标题可以补上（记忆 summary / 叼回 title 比裸 URL 更可读）
      if (existing.label === url && label) existing.label = label;
      return id;
    }
    nodes.set(id, { id, kind: 'page', label: label ?? url, url });
    return id;
  }

  function addEdge(source: string, target: string, kind: GraphEdgeKind): void {
    const key = `${source}|${target}|${kind}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push({ source, target, kind, label: EDGE_LABELS[kind] });
  }

  for (const m of memories) {
    const topic = topicOf(m.tags, m.type);
    const mid = `m:${m.id}`;
    nodes.set(mid, {
      id: mid,
      kind: 'memory',
      label: m.summary,
      timestamp: m.timestamp,
      key: `${m.timestamp}|record_knowledge`,
    });
    if (m.url) {
      const pid = ensurePage(m.url, m.summary);
      addEdge(mid, pid, 'remembered');
      // 页面挂到主题枢纽下
      if (topic) addEdge(pid, ensureHub(topic), 'contains');
    } else if (topic) {
      // 旧数据无 url：直接挂主题枢纽
      addEdge(mid, ensureHub(topic), 'contains');
    }
  }

  for (const s of speaks) {
    const sid = `s:${s.timestamp}`;
    nodes.set(sid, {
      id: sid,
      kind: 'speak',
      label: s.title,
      ...(s.url ? { url: s.url } : {}),
      ...(s.gated ? { gated: true } : {}),
      timestamp: s.timestamp,
      key: `${s.timestamp}|speak`,
    });
    const topic = s.matchedTopics?.[0];
    if (s.url) {
      const pid = ensurePage(s.url, s.title);
      addEdge(sid, pid, 'mentioned');
      if (topic) addEdge(pid, ensureHub(topic), 'contains');
    } else if (topic) {
      addEdge(sid, ensureHub(topic), 'contains');
    }
    // 无 url 且无命中话题：悬空节点，呈现为游离点
  }

  return { nodes: [...nodes.values()], edges };
}
