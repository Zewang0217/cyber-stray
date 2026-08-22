// @vitest-environment jsdom
/**
 * InterestTimeline 测试（#115 进化页折线图可读性）
 *
 * 契约：
 * - buildSeries：按最新权重降序；后诞生兴趣从首次出现起记点（缺节点不画 0——
 *   防幽灵零点拖垮动态 Y 轴）；latest/source 取最后一次出现
 * - yDomain：数据 min-max 留 12% 边且夹在 [0,1]；全等退化时对称放大；空数据回 [0,1]
 * - clusterFeedbacks：近距事件聚一面旗且**按类型**计数；远距分开；范围外丢弃
 * - 渲染：>TOP_N 条默认只画 TOP_N 条 + "查看全部"可展开；图例点击钉住高亮（线加粗）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EvolutionSnapshot, FeedbackEvent } from '@/hooks/useEvolution';
import {
  InterestTimeline,
  TOP_N,
  buildSeries,
  clusterFeedbacks,
  yDomain,
  type SeriesPoint,
} from './InterestTimeline';

const T0 = Date.UTC(2026, 7, 21, 10, 0);
const MIN = 60_000;

function snapshot(mins: number, nodes: { id: string; weight: number; source?: string }[]): EvolutionSnapshot {
  return {
    timestamp: new Date(T0 + mins * MIN).toISOString(),
    hash: `h-${mins}`,
    entropy: 1,
    source: 'snapshot',
    nodes: nodes.map((n, i) => ({ id: n.id, weight: n.weight, source: n.source ?? 'default', reinforceCount: i })),
  };
}

function feedback(type: FeedbackEvent['type'], mins: number): FeedbackEvent {
  return { type, timestamp: new Date(T0 + mins * MIN).toISOString() };
}

describe('buildSeries（#115 P0 前置）', () => {
  it('按最新权重降序;缺节点记 0;latest/source 取最后一次出现', () => {
    const snapshots = [
      snapshot(0, [
        { id: 'ai-agents', weight: 0.5 },
        { id: 'rust-lang', weight: 0.7 },
      ]),
      snapshot(30, [
        { id: 'ai-agents', weight: 0.8, source: 'feedback' },
        { id: 'rust-lang', weight: 0.2 },
      ]),
    ];
    const series = buildSeries(snapshots);
    expect(series.map((s) => s.id)).toEqual(['ai-agents', 'rust-lang']);
    const ai = series[0]!;
    expect(ai.points.map((p) => p.w)).toEqual([0.5, 0.8]);
    expect(ai.latest).toBe(0.8);
    expect(ai.source).toBe('feedback');
  });

  it('后诞生的兴趣从首次出现起记点——早期快照缺节点不画 0（防幽灵零点拖垮动态 Y 轴）', () => {
    const series = buildSeries([snapshot(0, [{ id: 'a', weight: 1 }]), snapshot(30, [{ id: 'a', weight: 1 }, { id: 'b', weight: 0.4 }])]);
    const b = series.find((s) => s.id === 'b')!;
    expect(b.points.map((p) => p.w)).toEqual([0.4]);
    // 幽灵零点不进 yDomain：仅真实出现的点参与 min-max
    const { min, max } = yDomain(b.points);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(0.4);
  });
});

describe('yDomain（#115 P0 动态 Y 轴）', () => {
  it('生产形态 0.2-0.75 → 留边且仍在 [0,1]', () => {
    const pts: SeriesPoint[] = [
      { t: 0, w: 0.2 },
      { t: 1, w: 0.75 },
    ];
    const { min, max } = yDomain(pts);
    expect(min).toBeLessThan(0.2);
    expect(max).toBeGreaterThan(0.75);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('全等退化 → 对称放大;空数据 → [0,1]', () => {
    const degenerate = yDomain([{ t: 0, w: 0.2 }, { t: 1, w: 0.2 }]);
    expect(degenerate.max - degenerate.min).toBeGreaterThan(0.05);
    expect(yDomain([])).toEqual({ min: 0, max: 1 });
  });

  it('触界数据(全 1.0)夹在 [0,1] 内仍非退化', () => {
    const d = yDomain([{ t: 0, w: 1 }, { t: 1, w: 1 }]);
    expect(d.max - d.min).toBeGreaterThan(0.05);
    expect(d.max).toBeLessThanOrEqual(1);
  });
});

describe('clusterFeedbacks（#115 P2 反馈事件带）', () => {
  const span = 100 * MIN; // t0=T0, t1=T0+100min; plotWidth≈800px → 1min≈8px

  it('近距 3 条聚一面旗,按类型计数不丢失', () => {
    const clusters = clusterFeedbacks([feedback('like', 10), feedback('like', 11), feedback('boost', 12)], T0, T0 + span);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.counts).toEqual({ like: 2, dislike: 0, boost: 1 });
  });

  it('远距事件分开成多面旗;范围外丢弃', () => {
    const clusters = clusterFeedbacks(
      [feedback('like', 10), feedback('dislike', 50), feedback('like', -5), feedback('boost', 999)],
      T0,
      T0 + span,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.counts.like).toBe(1);
    expect(clusters[1]!.counts.dislike).toBe(1);
  });
});

describe('渲染（#115 P0 top-N + P1 图例高亮）', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    const reactActEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    reactActEnv.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** 20 节点、14 条同权重 0.2 的生产形态数据 */
  function prodSnapshots(): EvolutionSnapshot[] {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `interest-${String(i).padStart(2, '0')}`,
      weight: i < 14 ? 0.2 : 0.3 + i * 0.02,
    }));
    return [snapshot(0, many), snapshot(30, many.map((n) => ({ ...n, weight: n.weight + 0.05 })))];
  }

  it('默认只画 TOP_N 条,提供"查看全部"且可展开', () => {
    act(() => {
      root.render(<InterestTimeline snapshots={prodSnapshots()} feedbacks={[]} />);
    });
    const lines = () => container.querySelectorAll('svg[role="img"] polyline');
    expect(lines()).toHaveLength(TOP_N);
    const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('查看全部 20 条'));
    expect(toggle).toBeTruthy();
    act(() => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(lines()).toHaveLength(20);
  });

  it('图例点击钉住:对应线加粗(3.5),其余退淡', () => {
    act(() => {
      root.render(<InterestTimeline snapshots={prodSnapshots()} feedbacks={[]} />);
    });
    const legend = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('interest-19'))!;
    act(() => {
      legend.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const bold = [...container.querySelectorAll('polyline')].find((l) => l.getAttribute('stroke-width') === '3.5');
    expect(bold).toBeTruthy();
    // 钉住后出现尾部权重标签
    expect(container.textContent).toContain('interest-19');
  });
});
