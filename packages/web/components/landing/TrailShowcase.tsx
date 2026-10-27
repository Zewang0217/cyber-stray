"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { WanderStep } from "@cyber-stray/shared/agent-state";
import { buildTrailView, formatTrailClock, TRAIL_TOOL_LABELS, type TrailEvent } from "@cyber-stray/shared/trail";
import styles from "./landing.module.css";

const TrailMap = dynamic(() => import("@/components/trail/TrailMap").then((module) => module.TrailMap), {
  ssr: false,
  loading: () => <div className={styles.trailLoading}>正在展开小溜的足迹……</div>,
});

const STEPS = [
  { timestamp: "2026-10-26T05:52:33.122Z", tool: "search_web", title: "GPT-6 Astra Ultrafast OpenAI Blackwell", alley: "AI芯片产业巷", thought: "搜索: GPT-6 Astra Ultrafast OpenAI Blackwell" },
  { timestamp: "2026-10-26T05:52:50.562Z", tool: "read_page", title: "IT之家IT资讯", alley: "硅谷公告栏巷", thought: "读取: IT之家IT资讯", url: "https://it.ithome.com/" },
  { timestamp: "2026-10-26T05:53:06.338Z", tool: "read_page", title: "NVIDIA Blog", alley: "AI芯片产业巷", thought: "读取: NVIDIA Blog", url: "https://blogs.nvidia.com/" },
  { timestamp: "2026-10-26T05:53:36.113Z", tool: "read_page", title: "Kazakhstan Expands Compute for Its AI Future", alley: "主权算力巷", thought: "读取: Kazakhstan Expands Compute for Its AI Future", url: "https://blogs.nvidia.com/" },
  { timestamp: "2026-10-26T05:53:41.111Z", tool: "speak", title: "哈萨克斯坦要出口智能，不出口能源", alley: "主权算力巷", thought: "寄出一张明信片" },
  { timestamp: "2026-10-26T05:53:59.871Z", tool: "read_page", title: "马斯克重磅预测：neocloud 行业将遭遇死亡和整合", alley: "AI资本开支巷", thought: "读取: neocloud 行业整合预测", url: "https://wallstreetcn.com/" },
  { timestamp: "2026-10-26T05:54:07.089Z", tool: "record_knowledge", title: "AI 从朋友到敌人的量化账本", alley: "AI泡沫巷", thought: "记住: ROIC/WACC 与挤出效应" },
  { timestamp: "2026-10-26T05:54:21.179Z", tool: "speak", title: "马斯克举债 400 亿买 GPU", alley: "AI资本开支巷", thought: "寄出一张明信片", url: "https://wallstreetcn.com/" },
  { timestamp: "2026-10-26T05:54:25.364Z", tool: "read_page", title: "奇客资讯网", alley: "科学阅读巷", thought: "读取: 奇客资讯网", url: "https://www.solidot.org/" },
  { timestamp: "2026-10-26T05:54:32.986Z", tool: "speak", title: "为数据中心砍 25 万棵树，狼进村了", alley: "AI电力巷", thought: "寄出一张明信片", url: "https://www.solidot.org/" },
  { timestamp: "2026-10-26T05:54:39.027Z", tool: "record_knowledge", title: "数据中心的外部性账本", alley: "AI电力巷", thought: "记住: 芬兰砍林与 PJM 虚拟电厂" },
  { timestamp: "2026-10-26T05:54:46.507Z", tool: "rest", thought: "主动结束游荡" },
] satisfies WanderStep[];

const session = buildTrailView(STEPS)[0]!;

export function TrailShowcase() {
  const [selected, setSelected] = useState<TrailEvent>(session.events[4]!);
  return (
    <>
      <div className={styles.trailChart}><TrailMap session={session} onSelect={setSelected} /></div>
      <div className={styles.trailDetail} aria-live="polite">
        <span className={styles.mono}>{TRAIL_TOOL_LABELS[selected.tool]} · {formatTrailClock(selected.timestamp)}</span>
        <strong>{selected.title ?? selected.alley}</strong>
        <p>{selected.thought ?? "小溜在这里停了一下。"}</p>
      </div>
    </>
  );
}
