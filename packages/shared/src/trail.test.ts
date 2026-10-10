import { describe, test, expect } from 'vitest';
import { buildTrailView, buildGraphView } from './trail';

// 事件 fixture 派生自生产 wander-history 样本（scratch/trajectory-proto/），精简到覆盖各规则
const STEPS = [
  // 会话 1：含搜索、读到、失败、叼回（含拦截）、回窝
  { timestamp: '2026-10-08T16:00:00.000Z', tool: 'search_web', title: '量子计算 进展', alley: '量子巷', thought: '搜索(premium): 量子计算 进展' },
  { timestamp: '2026-10-08T16:01:00.000Z', tool: 'read_page', url: 'https://a.example/q1', title: 'IBM 新处理器', alley: '量子巷', thought: '读取: IBM 新处理器' },
  { timestamp: '2026-10-08T16:02:00.000Z', tool: 'read_page', url: 'https://a.example/dead', alley: '量子巷', status: 'failed' as const, thought: '读取失败: 403' },
  { timestamp: '2026-10-08T16:03:00.000Z', tool: 'record_knowledge', url: 'https://a.example/q1', title: 'Nighthawk r2', alley: '量子巷', thought: '记住了: Nighthawk r2' },
  { timestamp: '2026-10-08T16:04:00.000Z', tool: 'speak', spoke: '喵！大瓜…', title: '量子大瓜', alley: '量子巷', thought: '[share] 表达了想法' },
  { timestamp: '2026-10-08T16:05:00.000Z', tool: 'speak', spoke: '被拦的内容', title: '被拦叼回', alley: '量子巷', status: 'blocked' as const, thought: '[share] 内容被护栏拦截' },
  { timestamp: '2026-10-08T16:06:00.000Z', tool: 'rest', thought: '主动结束游荡' },
  // 会话 2：跨泳道跳跃 + browse_page 归一 + 无 alley 旧数据；无 rest 结尾（残段）
  { timestamp: '2026-10-08T17:00:00.000Z', tool: 'search_web', title: '2026 网络热梗', alley: '热词弄堂', thought: '搜索(premium): 2026 网络热梗' },
  { timestamp: '2026-10-08T17:01:00.000Z', tool: 'browse_page', url: 'https://b.example/meme', title: '热梗盘点', alley: '热词弄堂', thought: '浏览: 热梗盘点' },
  { timestamp: '2026-10-08T17:02:00.000Z', tool: 'read_page', url: 'https://c.example/old', thought: '读取: 旧数据无巷子' },
  // 非轨迹工具应被过滤
  { timestamp: '2026-10-08T17:03:00.000Z', tool: 'read_feedback', thought: '发现 0 条待处理反馈' },
];

describe('buildTrailView', () => {
  const sessions = buildTrailView(STEPS);
  const [s0, s1] = sessions;
  if (!s0 || !s1) throw new Error("fixture 应切出两个会话");

  test('按 rest 切分会话，末尾残段也算一个会话', () => {
    expect(sessions).toHaveLength(2);
    expect(s0.events.at(-1)?.tool).toBe('rest');
    expect(s1.events.length).toBe(3); // read_feedback 被过滤
  });

  test('会话元信息：日期 / 当天第几次 / 摘要（展示时区为东八区）', () => {
    // fixture 是 UTC：16:00Z/17:00Z 在东八区均为次日 00:00/01:00
    expect(s0.day).toBe('10-09');
    expect(s0.time).toBe('00:00');
    expect(s0.dayIndex).toBe(1);
    expect(s1.dayIndex).toBe(2);
    expect(s0.summary).toEqual({ durationMin: 6, steps: 7, speaks: 1 }); // 被拦截不计入叼回数
  });

  test('泳道：按首次出现排序，rest 落「窝」，旧数据落「无名小巷」', () => {
    expect(s0.lanes).toEqual(['量子巷', '窝']);
    expect(s1.lanes).toEqual(['热词弄堂', '无名小巷']);
    const rest = s0.events.at(-1);
    expect(rest?.alley).toBe('窝');
    expect(rest?.laneIndex).toBe(1);
  });

  test('browse_page 归一为 read_page', () => {
    expect(s1.events[1]?.tool).toBe('read_page');
  });

  test('status 直读：失败与拦截原样透出，无正则参与', () => {
    expect(s0.events[2]?.status).toBe('failed');
    expect(s0.events[5]?.status).toBe('blocked');
    expect(s0.events[1]?.status).toBeUndefined();
  });

  test('桥接键 = timestamp + tool', () => {
    expect(s0.events[0]?.key).toBe('2026-10-08T16:00:00.000Z|search_web');
  });
});

describe('buildGraphView', () => {
  const MEMORIES = [
    { id: 'k1', type: 'knowledge', timestamp: '2026-10-08T16:03:00.000Z', tags: ['knowledge', '量子'], summary: 'Nighthawk r2', url: 'https://a.example/q1' },
    // 旧数据无 url → 挂主题枢纽
    { id: 'k2', type: 'knowledge', timestamp: '2026-09-28T03:20:00.000Z', tags: ['knowledge', '天文'], summary: '系外行星极光' },
    // 非 knowledge 类型不进图谱
    { id: 'p1', type: 'profile', timestamp: '2026-09-28T00:00:00.000Z', tags: ['profile', '偏好'], summary: '主人画像' },
  ];
  const SPEAKS = [
    { timestamp: '2026-10-08T16:04:00.000Z', title: '量子大瓜', url: 'https://a.example/q1', matchedTopics: ['量子'] },
    { timestamp: '2026-10-08T16:05:00.000Z', title: '被拦叼回', gated: true, matchedTopics: ['量子'] },
    // 无 url 无话题 → 悬空
    { timestamp: '2026-10-08T18:00:00.000Z', title: '碎碎念' },
  ];
  const { nodes, edges } = buildGraphView(MEMORIES, SPEAKS);

  test('记忆→页面按 url 连边，页面挂主题枢纽', () => {
    expect(edges).toContainEqual({ source: 'm:k1', target: 'p:https://a.example/q1', kind: 'remembered', label: '它记住了这个页面里的东西' });
    expect(edges).toContainEqual({ source: 'p:https://a.example/q1', target: 'h:量子', kind: 'contains', label: '这条内容属于这个主题' });
  });

  test('无 url 旧记忆回落主题枢纽；非 knowledge 类型被过滤', () => {
    expect(edges).toContainEqual({ source: 'm:k2', target: 'h:天文', kind: 'contains', label: '这条内容属于这个主题' });
    expect(nodes.find((n) => n.id === 'm:p1')).toBeUndefined();
  });

  test('叼回按 url 连页面；gated 置灰；无 url 连命中话题枢纽', () => {
    expect(edges).toContainEqual({ source: 's:2026-10-08T16:04:00.000Z', target: 'p:https://a.example/q1', kind: 'mentioned', label: '叼回时提到了这个页面' });
    expect(nodes.find((n) => n.id === 's:2026-10-08T16:05:00.000Z')?.gated).toBe(true);
    expect(edges).toContainEqual({ source: 's:2026-10-08T16:05:00.000Z', target: 'h:量子', kind: 'contains', label: '这条内容属于这个主题' });
  });

  test('无 url 无话题的叼回悬空（无边）', () => {
    const floating = nodes.find((n) => n.id === 's:2026-10-08T18:00:00.000Z');
    expect(floating).toBeDefined();
    expect(edges.filter((e) => e.source === floating?.id || e.target === floating?.id)).toHaveLength(0);
  });

  test('页面节点跨来源去重，更好标题可补上', () => {
    expect(nodes.filter((n) => n.kind === 'page')).toHaveLength(1);
    expect(nodes.find((n) => n.kind === 'page')?.label).toBe('Nighthawk r2');
  });

  test('桥接键透传：memory→record_knowledge，speak→speak', () => {
    expect(nodes.find((n) => n.id === 'm:k1')?.key).toBe('2026-10-08T16:03:00.000Z|record_knowledge');
    expect(nodes.find((n) => n.id === 's:2026-10-08T16:04:00.000Z')?.key).toBe('2026-10-08T16:04:00.000Z|speak');
  });
});
