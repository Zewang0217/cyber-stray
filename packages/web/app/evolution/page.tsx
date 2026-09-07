"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useEvolution } from "@/hooks/useEvolution";
import { useInterestGraph } from "@/hooks/useInterestGraph";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { InterestAtlas } from "@/components/strayboy/InterestAtlas";
import { TimeMachine } from "@/components/strayboy/TimeMachine";
import { CoatPicker } from "@/components/strayboy/CoatPicker";
import { DEMO_NODES, DEMO_SNAPSHOTS } from "@/lib/strayboy/demo";
import { GRUMPY_MS } from "@/hooks/usePatStreak";
import type { InterestNodeData } from "@/lib/types";
import type { EvolutionSnapshot } from "@/hooks/useEvolution";

const GRUMPY_KEY = "sb_grumpy_until";
const DEMO_ENTROPY = 1.71;

/**
 * 图鉴（/evolution，#170 映射）：兴趣条目轨道 + 时间机器 SAVE SLOT。
 * 回滚 = 「读取存档 LOAD」；成功后写 sb_grumpy_until（街角猫 grumpy 30s 演出）。
 * ?demo=1 夹具通道（同街角/墙上）。
 */
function EvolutionInner() {
  const demo = useSearchParams().get("demo") === "1";
  const live = useTenantEvents({ enabled: !demo });
  const evolution = useEvolution({ enabled: !demo });
  const graph = useInterestGraph({ refreshSignal: demo ? 0 : live.refreshSignal, enabled: !demo });
  const entropy = demo ? DEMO_ENTROPY : graph.entropy;

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
    if (demo) {
      // 演示通道：模拟读取成功（不 POST 真实回滚）
      localStorage.setItem(GRUMPY_KEY, String(Date.now() + 30_000));
      toast("存档已读取。猫记仇 30 秒。");
      return true;
    }
    setRolling(true);
    const ok = await evolution.rollback(hash);
    setRolling(false);
    if (ok) {
      localStorage.setItem(GRUMPY_KEY, String(Date.now() + GRUMPY_MS));
      toast("存档已读取。猫记仇 30 秒。");
    }
    return ok;
  };

  return (
    <div className="sb mx-auto max-w-3xl p-3">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="font-ps2p text-xs text-[var(--hi)]">DEX · 兴趣图鉴</h1>
        <span className="font-vt323 text-[20px] text-[var(--curb)]">
          {demo ? "DEMO FEED · " : ""}熵 {entropy.toFixed(2)}
        </span>
      </header>

      <InterestAtlas nodes={nodes} />

      <h2 className="font-ps2p mb-3 mt-8 text-xs text-[var(--hi)]">SKIN · 图鉴皮肤</h2>
      <div className="mb-2 border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
        <CoatPicker />
        <p className="mt-1.5 text-[11px] text-[var(--curb)]">选择后街角同步换色（橘/黑/三花，DESIGN.md §7）。</p>
      </div>

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
