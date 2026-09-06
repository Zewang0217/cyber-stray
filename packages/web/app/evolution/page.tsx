"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useEvolution } from "@/hooks/useEvolution";
import { useInterestGraph } from "@/hooks/useInterestGraph";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { InterestAtlas } from "@/components/strayboy/InterestAtlas";
import { TimeMachine } from "@/components/strayboy/TimeMachine";
import { DEMO_NODES, DEMO_SNAPSHOTS } from "@/lib/strayboy/demo";
import type { InterestNodeData } from "@/lib/types";
import type { EvolutionSnapshot } from "@/hooks/useEvolution";

const GRUMPY_KEY = "sb_grumpy_until";
const GRUMPY_MS = 30_000;

/**
 * 图鉴（/evolution，#170 映射）：兴趣条目轨道 + 时间机器 SAVE SLOT。
 * 回滚 = 「读取存档 LOAD」；成功后写 sb_grumpy_until（街角猫 grumpy 30s 演出）。
 * ?demo=1 夹具通道（同街角/墙上）。
 */
function EvolutionInner() {
  const demo = useSearchParams().get("demo") === "1";
  const live = useTenantEvents({ enabled: !demo });
  const evolution = useEvolution();
  const graph = useInterestGraph({ refreshSignal: demo ? 0 : live.refreshSignal });

  const [rolling, setRolling] = useState(false);
  const nodeCountRef = useRef<number | null>(null);
  const nodes = (demo ? DEMO_NODES : graph.nodes) as InterestNodeData[];
  const snapshots = (demo ? DEMO_SNAPSHOTS : evolution.data) as unknown as EvolutionSnapshot[];

  // 新话题到达（nodeCount 增加）→ toast（街角猫的 pounce 演出在街角页）
  useEffect(() => {
    if (demo || nodes.length === 0) return;
    if (nodeCountRef.current !== null && nodes.length > nodeCountRef.current) {
      toast("叼回来一个新话题！");
    }
    nodeCountRef.current = nodes.length;
  }, [demo, nodes.length]);

  const onLoad = async (hash: string): Promise<boolean> => {
    setRolling(true);
    const ok = await evolution.rollback(hash);
    setRolling(false);
    if (ok) {
      localStorage.setItem(GRUMPY_KEY, String(Date.now() + GRUMPY_MS));
      toast("存档已读取。猫记仇 30 秒。");
      void evolution.refresh();
    }
    return ok;
  };

  return (
    <div className="sb mx-auto max-w-3xl p-3">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="font-ps2p text-xs text-[var(--hi)]">DEX · 兴趣图鉴</h1>
        <span className="font-vt323 text-[20px] text-[var(--curb)]">
          {demo ? "DEMO FEED · " : ""}熵 {(graph.entropy ?? 0).toFixed(2)}
        </span>
      </header>

      <InterestAtlas nodes={nodes} />

      <h2 className="font-ps2p mb-3 mt-8 text-xs text-[var(--hi)]">TIME MACHINE · 存档</h2>
      <TimeMachine snapshots={snapshots} onLoad={onLoad} rolling={rolling} />
    </div>
  );
}

export default function EvolutionPage() {
  return (
    <Suspense>
      <EvolutionInner />
    </Suspense>
  );
}
