"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { buildGraphView, buildTrailView, formatTrailClock, TRAIL_TOOL_LABELS, type GraphNode, type GraphView, type TrailEvent, type TrailSession } from "@cyber-stray/shared/trail";
import { TrailMap } from "@/components/trail/TrailMap";
import { TrailGraph } from "@/components/trail/TrailGraph";
import { HOUSE, STAR, type ChartHandle } from "@/components/trail/chart-setup";
import { DEMO_TRAIL_MEMORY, DEMO_TRAIL_SPEAKS, DEMO_TRAIL_STEPS } from "@/lib/strayboy/demo";
import styles from "./trail.module.css";

type View = "trail" | "graph";

interface TrailData {
  sessions: TrailSession[];
  graph: GraphView;
}

const GRAPH_KIND_LABELS: Record<GraphNode["kind"], string> = {
  hub: "主题",
  page: "页面",
  memory: "记忆",
  speak: "叼回",
};

/** 显式拉取三个数据源（无兜底；任一失败呈现错误，可重试）。 */
function useTrailData(demo: boolean): { data: TrailData | null; error: string | null; retry: () => void } {
  const [data, setData] = useState<TrailData | null>(
    demo
      ? {
          sessions: buildTrailView(DEMO_TRAIL_STEPS),
          graph: buildGraphView(DEMO_TRAIL_MEMORY, DEMO_TRAIL_SPEAKS),
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (demo) return;
    (async () => {
      const [fpRes, memRes, spkRes] = await Promise.all([
        fetch("/api/footprint"),
        fetch("/api/trail/memory"),
        fetch("/api/trail/speaks"),
      ]);
      for (const res of [fpRes, memRes, spkRes]) {
        if (!res.ok) throw new Error(`数据加载失败（${res.status}）`);
      }
      const [fp, mem, spk] = await Promise.all([fpRes.json(), memRes.json(), spkRes.json()]) as [
        { success: boolean; data?: unknown[]; error?: string },
        { success: boolean; data?: unknown[]; error?: string },
        { success: boolean; data?: unknown[]; error?: string },
      ];
      if (!fp.success || !mem.success || !spk.success) {
        throw new Error(fp.error ?? mem.error ?? spk.error ?? "数据加载失败");
      }
      setData({
        sessions: buildTrailView(fp.data ?? []),
        graph: buildGraphView(mem.data ?? [], spk.data ?? []),
      });
      setError(null);
    })().catch((err) => setError(err instanceof Error ? err.message : "网络错误"));
  }, [demo, attempt]);

  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

const STAR_D = STAR.replace("path://", "");
const HOUSE_D = HOUSE.replace("path://", "");

/** 图例符号与图表符号同源（chart-setup 的 path 常量），语义一眼可读 */
const LEGEND_TRAIL: Array<{ glyph: ReactNode; text: string }> = [
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><path d="M10 2 18 10 10 18 2 10Z" fill="var(--panel)" stroke="var(--curb)" strokeWidth="1.5" /></svg>, text: "搜索" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" fill="var(--panel)" stroke="var(--star)" strokeWidth="1.6" /></svg>, text: "读页面" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><g transform="translate(10 10) scale(0.68)"><path d={STAR_D} fill="var(--hi)" /></g></svg>, text: "叼回" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><g transform="translate(10 10) scale(0.6)"><path d={STAR_D} fill="var(--curb)" /></g></svg>, text: "叼回被拦" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="5" fill="var(--bld-far)" stroke="var(--hi)" strokeWidth="1.2" /></svg>, text: "记住" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><g transform="translate(10 11) scale(0.72)"><path d={HOUSE_D} fill="var(--panel)" stroke="var(--star)" strokeWidth="1.8" /></g></svg>, text: "回窝" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><path d="M9 3h2v3h-2z M9 14h2v3h-2z M3 9h3v2h-3z M14 9h3v2h-3z M8 8h4v4h-4z" fill="var(--star)" /></svg>, text: "表情包" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" fill="none" stroke="var(--curb)" strokeWidth="1.4" strokeDasharray="3 2" /><path d="M7 7 13 13M13 7 7 13" stroke="var(--curb)" strokeWidth="1.4" /></svg>, text: "没进去的门" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><rect x="1" y="6" width="18" height="8" fill="rgba(59,93,201,0.18)" stroke="var(--curb)" strokeDasharray="3 2" /></svg>, text: "巷子泳道" },
];

const LEGEND_GRAPH: Array<{ glyph: ReactNode; text: string }> = [
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><rect x="1" y="5" width="18" height="10" fill="var(--bld-far)" stroke="var(--hi)" strokeWidth="1.3" /></svg>, text: "主题枢纽" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" fill="var(--panel)" stroke="var(--star)" strokeWidth="1.6" /></svg>, text: "页面" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="3.5" fill="var(--curb)" /></svg>, text: "记忆" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><g transform="translate(10 10) scale(0.68)"><path d={STAR_D} fill="var(--hi)" /></g></svg>, text: "叼回" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><g transform="translate(10 10) scale(0.6)"><path d={STAR_D} fill="var(--curb)" /></g></svg>, text: "被拦的叼回" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><path d="M2 10H18" stroke="var(--street)" strokeWidth="2" /></svg>, text: "记住 / 属于" },
  { glyph: <svg viewBox="0 0 20 20" aria-hidden><path d="M2 10H18" stroke="var(--hi)" strokeWidth="2" strokeDasharray="4 3" /></svg>, text: "叼回时提到" },
];

function Legend({ view }: { view: View }) {
  return (
    <section className={styles.legend} aria-label="图例">
      <h2>图例</h2>
      <div className={styles.legendGrid}>
        {(view === "trail" ? LEGEND_TRAIL : LEGEND_GRAPH).map((item) => (
          <div key={item.text} className={styles.legendItem}>
            {item.glyph}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrailPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const view: View = params.get("view") === "graph" ? "graph" : "trail";
  const { data, error, retry } = useTrailData(demo);

  // 默认选最近一次游荡（数组末尾）；?session=N 可定位
  const sessionParam = params.get("session");
  const parsed = sessionParam === null ? NaN : Number(sessionParam);
  const sessionIndex = data && Number.isInteger(parsed) && parsed >= 0 && parsed < data.sessions.length
    ? parsed
    : (data?.sessions.length ?? 1) - 1;
  const session = data?.sessions[sessionIndex];

  const [detail, setDetail] = useState<TrailEvent | null>(null);
  const [graphDetail, setGraphDetail] = useState<GraphNode | null>(null);
  const mapRef = useRef<ChartHandle>(null);
  const graphRef = useRef<ChartHandle>(null);

  const setParams = useCallback((next: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.replace(`/trail?${q.toString()}`, { scroll: false });
  }, [params, router]);

  /** F → A 桥接：key = timestamp+tool；目标游荡超出保留窗口则提示 */
  const jumpToTrail = useCallback((key: string) => {
    if (!data) return;
    const idx = data.sessions.findIndex((s) => s.events.some((e) => e.key === key));
    if (idx < 0) {
      toast("这次游荡已经超出足迹保留窗口，看不到了——但它记住的东西还在图里。");
      return;
    }
    setDetail(data.sessions[idx].events.find((e) => e.key === key) ?? null);
    setParams({ view: "trail", session: String(idx) });
  }, [data, setParams]);

  /** A → F 桥接：足迹步按 key（叼回/记住）或 url（读到的页面）找回图谱节点 */
  const graphNodeOf = useCallback((e: TrailEvent): GraphNode | undefined => {
    if (!data) return undefined;
    return data.graph.nodes.find((n) => n.key === e.key)
      ?? (e.url ? data.graph.nodes.find((n) => n.url === e.url) : undefined);
  }, [data]);

  // 键盘：←→ 换一趟游荡，Esc 收起详情
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDetail(null);
        setGraphDetail(null);
        return;
      }
      if (view !== "trail" || !data || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const next = sessionIndex + (e.key === "ArrowRight" ? 1 : -1);
      if (next < 0 || next >= data.sessions.length) return;
      setDetail(null);
      setParams({ session: String(next) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, data, sessionIndex, setParams]);

  const graphNode = useMemo(
    () => (graphDetail && data?.graph.nodes.some((n) => n.id === graphDetail.id) ? graphDetail : null),
    [graphDetail, data],
  );

  const header = (
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>WANDER TRAIL</p>
        <h1>
          游荡足迹
          {demo && <span className={styles.demoTag}>演示数据</span>}
        </h1>
      </div>
      <div className={styles.viewTabs} role="tablist" aria-label="足迹视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === "trail"}
          className={view === "trail" ? styles.on : ""}
          onClick={() => setParams({ view: "trail" })}
        >
          足迹地图
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "graph"}
          className={view === "graph" ? styles.on : ""}
          onClick={() => setParams({ view: "graph" })}
        >
          关系图谱
        </button>
      </div>
    </header>
  );

  if (error) {
    return (
      <div className={styles.page}>
        {header}
        <div className={`${styles.stateBox} ${styles.stateBoxSpaced}`}>
          <p className={styles.error}>足迹没取到：{error}</p>
          <button type="button" className={styles.retry} onClick={retry}>再试一次</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={styles.page}>
        {header}
        <p className={`${styles.stateBox} ${styles.stateBoxSpaced}`}>正在翻足迹……<span className="sb-blink">■</span></p>
      </div>
    );
  }

  const emptyText = view === "trail"
    ? "它还没出门溜达过。等它出门，足迹会画在这里。"
    : "图谱还空着。它记住东西之后，这里会长出街网。";
  const isEmpty = view === "trail" ? data.sessions.length === 0 : data.graph.nodes.length === 0;

  return (
    <div className={styles.page}>
      {header}

      {isEmpty ? (
        <div className={`${styles.stateBox} ${styles.stateBoxSpaced}`}>{emptyText}</div>
      ) : (
        <div className={styles.workspace}>
          <section className={styles.chartCol} aria-label={view === "trail" ? "足迹地图" : "关系图谱"}>
            {view === "trail" && session ? (
              <>
                <div className={styles.sessionBar}>
                  <div className={styles.sessionTabs} role="tablist" aria-label="游荡会话">
                    {data.sessions.map((s, i) => (
                      <button
                        key={s.index}
                        type="button"
                        role="tab"
                        aria-selected={i === sessionIndex}
                        className={i === sessionIndex ? styles.on : ""}
                        onClick={() => { setDetail(null); setParams({ session: String(i) }); }}
                      >
                        {s.day} {s.time}{s.dayIndex > 1 ? ` ·第${s.dayIndex}次` : ""}
                      </button>
                    ))}
                  </div>
                  <dl className={styles.stats}>
                    <div><dt>溜了</dt><dd>{session.summary.durationMin}分</dd></div>
                    <div><dt>站</dt><dd>{session.summary.steps}</dd></div>
                    <div><dt>叼回</dt><dd>{session.summary.speaks}</dd></div>
                  </dl>
                </div>
                <div className={styles.chartBox}>
                  <TrailMap ref={mapRef} session={session} onSelect={setDetail} />
                  <button type="button" className={styles.fitBtn} onClick={() => mapRef.current?.fit()}>全貌</button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.sessionBar}>
                  <dl className={styles.stats}>
                    <div><dt>节点</dt><dd>{data.graph.nodes.length}</dd></div>
                    <div><dt>边</dt><dd>{data.graph.edges.length}</dd></div>
                  </dl>
                </div>
                <div className={styles.chartBox}>
                  <TrailGraph ref={graphRef} graph={data.graph} selectedId={graphNode?.id ?? null} onSelect={setGraphDetail} />
                  <button type="button" className={styles.fitBtn} onClick={() => graphRef.current?.fit()}>全貌</button>
                </div>
              </>
            )}
          </section>

          <aside className={styles.rail}>
            <section className={styles.detail} aria-live="polite" aria-label="详情">
              {view === "trail" ? (
                detail ? (
                  <>
                    <div className={styles.detailHead}>
                      <span className={styles.toolTag}>{TRAIL_TOOL_LABELS[detail.tool] ?? detail.tool}</span>
                      {detail.status === "failed" && <span className={styles.badgeMuted}>没进去的门</span>}
                      {detail.status === "blocked" && <span className={styles.badge}>被护栏拦下</span>}
                      <time className={styles.clock}>{formatTrailClock(detail.timestamp)}</time>
                    </div>
                    {detail.title && <p className={styles.title}>{detail.title}</p>}
                    {detail.thought && <p className={styles.thought}>{detail.thought}</p>}
                    {detail.spoke && <div className={styles.spoke}>{detail.spoke}</div>}
                    {detail.url && <a className={styles.link} href={detail.url} target="_blank" rel="noopener">{detail.url}</a>}
                    {(() => {
                      const node = graphNodeOf(detail);
                      return node ? (
                        <button
                          type="button"
                          className={styles.jump}
                          onClick={() => { setGraphDetail(node); setParams({ view: "graph" }); }}
                        >
                          在图谱里看它 →
                        </button>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <p className={styles.emptyHint}>点地图上的节点，看它当时在想什么。</p>
                )
              ) : graphNode ? (
                <>
                  <div className={styles.detailHead}>
                    <span className={styles.toolTag}>{GRAPH_KIND_LABELS[graphNode.kind]}</span>
                    {graphNode.gated && <span className={styles.badge}>被护栏拦下</span>}
                    {graphNode.timestamp && <time className={styles.clock}>{formatTrailClock(graphNode.timestamp)}</time>}
                  </div>
                  <p className={styles.title}>{graphNode.label}</p>
                  {graphNode.url && <a className={styles.link} href={graphNode.url} target="_blank" rel="noopener">{graphNode.url}</a>}
                  {graphNode.key && (
                    <button type="button" className={styles.jump} onClick={() => { if (graphNode.key) jumpToTrail(graphNode.key); }}>
                      回到那趟游荡 →
                    </button>
                  )}
                </>
              ) : (
                <p className={styles.emptyHint}>点一个节点，看看它连着什么。</p>
              )}
            </section>

            <Legend view={view} />
            <p className={styles.hint}>
              {view === "trail" ? "滚轮缩放 · 拖拽平移 · 点节点看详情 · ←→ 换一趟 · Esc 收起" : "拖拽移动 · 滚轮缩放 · 点节点看详情 · Esc 收起"}
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

export default function TrailPage() {
  return (
    <Suspense>
      <TrailPageInner />
    </Suspense>
  );
}
