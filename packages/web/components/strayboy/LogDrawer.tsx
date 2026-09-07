"use client";

import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { DEMO_LOG } from "@/lib/strayboy/demo";

interface FootprintStep {
  timestamp: string;
  tool: string;
  thought?: string;
  url?: string;
}

/**
 * LOG 存档抽屉（#170 足迹映射）：vaul 移动抽屉，游荡日志历史（VT323）。
 * 数据 = GET /api/footprint（agent 每步落盘）；?demo=1 夹具。
 */
export function LogDrawer({ open, onOpenChange, demo }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  demo?: boolean;
}) {
  const [steps, setSteps] = useState<Array<FootprintStep & { spokeText?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || demo) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/footprint");
        const json = (await res.json()) as { success: boolean; error?: string; data?: FootprintStep[] };
        if (!json.success) throw new Error(json.error ?? "加载失败");
        setSteps(json.data ?? []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, demo]);

  const list = demo ? DEMO_LOG : steps;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[80] bg-black/70" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[85] mx-auto max-h-[70vh] max-w-3xl border-t-2 border-[var(--curb)] bg-[var(--panel)] p-4 outline-none">
          <div className="mx-auto mb-3 h-1 w-12 bg-[var(--curb)]" />
          <Drawer.Title className="font-ps2p mb-3 text-xs text-[var(--hi)]">LOG · 存档</Drawer.Title>
          {error && (
            <p className="border-2 border-[var(--bad)] bg-[var(--sky)] p-2 text-[13px] text-[var(--bad)]">
              读存档失败：{error}
            </p>
          )}
          {loading && <p className="py-8 text-[13px] text-[var(--curb)]">读取中……</p>}
          <div className="max-h-[50vh] overflow-auto border-2 border-black bg-black p-3 font-vt323 text-[20px] leading-[1.5] text-[var(--ok)]">
            {list.map((step, i) => (
              <p key={i}>
                &gt; <span className="text-[var(--curb)]">{step.timestamp.slice(0, 16).replace("T", " ")}</span>{" "}
                {step.spokeText ?? step.thought ?? step.url ?? `${step.tool} 逛了一圈。`}
              </p>
            ))}
            {list.length === 0 && !loading && <p>&gt; 存档是空的。</p>}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
