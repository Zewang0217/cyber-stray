"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePetGen } from "@/hooks/usePetGen";
import { GenerationWorkshop } from "./GenerationWorkshop";

/** 街角展示后台生图状态；只有任务存在时展示，不把请求失败当成没有任务。 */
export function PetArrivalPanel({ refreshSignal }: { refreshSignal: number }) {
  const { task, error, refresh } = usePetGen({ loadQuota: false, refreshSignal });
  const previousTask = useRef<typeof task>(null);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  useEffect(() => {
    if (task?.status === "done" && previousTask.current?.id === task.id && previousTask.current.status !== "done") setArrivedId(task.id);
    previousTask.current = task;
  }, [task]);
  if (error) return <div role="alert" className="mx-auto max-w-3xl px-3 pt-3 text-[13px] text-[var(--bad)]">
    形象进度暂时没有接通：{error}
    <button type="button" onClick={() => void refresh()} className="ml-3 min-h-11 border-2 px-3">重新连接</button>
  </div>;
  if (!task || (task.status === "done" && arrivedId !== task.id)) return null;
  return <div className="sb mx-auto max-w-3xl px-3 pt-3">
    <GenerationWorkshop key={task.id} task={task} compact />
    {task.status === "done" && <button type="button" onClick={() => setArrivedId(null)} className="mt-3 min-h-11 border-2 border-[var(--ok)] px-3 text-[13px] text-[var(--ok)]">收到，街角见！</button>}
    {task.status === "failed" && <p role="alert" className="mt-3 text-[13px] text-[var(--bad)]">生成失败：{task.error}</p>}
    <Link href="/pet/customize" className="mt-3 inline-flex min-h-11 items-center border-2 border-[var(--curb)] px-3 text-[13px] text-[var(--hi)]">
      {task.status === "failed" ? "查看原因与重试方式" : task.status === "awaiting_confirmation" ? "去确认这张概念图" : "打开形象小工坊"} ▶
    </Link>
    {task.status !== "done" && <p className="mt-2 text-[12px] text-[var(--curb)]">专属形象完成前，街角先显示临时形象。</p>}
  </div>;
}
