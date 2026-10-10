"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildGraphView, buildTrailView, formatTrailClock, TRAIL_TOOL_LABELS, type GraphNode, type GraphView, type TrailEvent, type TrailSession } from "@cyber-stray/shared/trail";
import { TrailMap } from "@/components/trail/TrailMap";
import { TrailGraph } from "@/components/trail/TrailGraph";
import { DEMO_TRAIL_MEMORY, DEMO_TRAIL_SPEAKS, DEMO_TRAIL_STEPS } from "@/lib/strayboy/demo";
import styles from "./trail.module.css";

type View = "trail" | "graph";

interface TrailData {
  sessions: TrailSession[];
  graph: GraphView;
}

/** 显式拉取三个数据源（无兜底；任一失败呈现错误）。 */
function useTrailData(demo: boolean): { data: TrailData | null; error: string | null } {
  const [data, setData] = useState<TrailData | null>(
    demo
      ? {
          sessions: buildTrailView(DEMO_TRAIL_STEPS),
          graph: buildGraphView(DEMO_TRAIL_MEMORY, DEMO_TRAIL_SPEAKS),
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);

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
    })().catch((err) => setError(err instanceof Error ? err.message : "网络错误"));
  }, [demo]);

  return { data, error };
}

function TrailPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const view: View = params.get("view") === "graph" ? "graph" : "trail";
  const { data, error } = useTrailData(demo);

  // 默认选最近一次游荡（数组末尾）；?session=N 可定位
  const sessionParam = params.get("session");
  const parsed = sessionParam === null ? NaN : Number(sessionParam);
  const sessionIndex = data && Number.isInteger(parsed) && parsed >= 0 && parsed < data.sessions.length
    ? parsed
    : (data?.sessions.length ?? 1) - 1;
  const session = data?.sessions[sessionIndex];

  const [detail, setDetail] = useState<TrailEvent | null>(null);
  const [graphDetail, setGraphDetail] = useState<GraphNode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice("这次游荡已经超出足迹保留窗口，看不到了——但它记住的东西还在图里。");
      return;
    }
    setNotice(null);
    setDetail(data.sessions[idx].events.find((e) => e.key === key) ?? null);
    setParams({ view: "trail", session: String(idx) });
  }, [data, setParams]);

  const sessionHead = useMemo(() => {
    if (!session) return "";
    return `${session.day} ${session.time} 出门 · 溜了 ${session.summary.durationMin} 分钟 · ${session.summary.steps} 站 · ${session.summary.speaks} 次叼回 · 滚轮缩放 · 点击节点看详情`;
  }, [session]);

  if (error) return <div className={styles.page}><p className={styles.error}>{error}</p></div>;
  if (!data) return <div className={styles.page}><p className={styles.head}>加载中……</p></div>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>游荡足迹</h1>
        {demo && <span className={styles.demoTag}>演示数据</span>}
        <div className={styles.viewTabs}>
          <button className={view === "trail" ? styles.on : ""} onClick={() => setParams({ view: "trail" })}>足迹地图</button>
          <button className={view === "graph" ? styles.on : ""} onClick={() => setParams({ view: "graph" })}>关系图谱</button>
        </div>
      </header>

      {view === "trail" && (
        <>
          <div className={styles.sessionTabs}>
            {data.sessions.map((s, i) => (
              <button
                key={s.index}
                className={i === sessionIndex ? styles.on : ""}
                onClick={() => { setDetail(null); setParams({ session: String(i) }); }}
              >
                {s.day} {s.time}{s.dayIndex > 1 ? ` ·第${s.dayIndex}次` : ""}
              </button>
            ))}
          </div>
          <div className={styles.head}>{sessionHead}</div>
          {session && <TrailMap session={session} onSelect={setDetail} />}
          <div className={styles.detail}>
            {detail ? (
              <>
                <button
                  className={styles.badge}
                  title="在关系图谱中看这条巷子"
                  onClick={() => setParams({ view: "graph" })}
                >
                  {detail.alley}
                </button>
                <b className={styles.title}>{TRAIL_TOOL_LABELS[detail.tool] ?? detail.tool}</b>{" "}
                <span>{formatTrailClock(detail.timestamp)}</span>
                {detail.title && <div className={styles.thought}>{detail.title}</div>}
                {detail.thought && <div className={styles.thought}>{detail.thought}</div>}
                {detail.spoke && <div className={styles.spoke}>{detail.spoke}</div>}
                {detail.url && <a href={detail.url} target="_blank" rel="noopener">{detail.url}</a>}
              </>
            ) : (
              "🐾 点一个节点，看它当时在想什么。"
            )}
          </div>
        </>
      )}

      {view === "graph" && (
        <>
          <div className={styles.head}>
            {data.graph.nodes.length} 个节点 · {data.graph.edges.length} 条边 · 拖拽移动 · 滚轮缩放 · 点记忆/叼回节点跳回那次游荡
          </div>
          <TrailGraph graph={data.graph} onJump={jumpToTrail} onSelect={setGraphDetail} />
          {notice && <div className={styles.notice}>{notice}</div>}
          <div className={styles.detail}>
            {graphDetail ? (
              <>
                <b className={styles.title}>{graphDetail.label}</b>
                {graphDetail.gated && <span className={styles.badge}>被护栏拦下</span>}
                {graphDetail.url && <div><a href={graphDetail.url} target="_blank" rel="noopener">{graphDetail.url}</a></div>}
              </>
            ) : (
              "🕸️ 点一个节点，看看它连着什么。"
            )}
          </div>
        </>
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
