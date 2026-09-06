"use client";

import { useEffect, useState } from "react";
import type { SpriteContract } from "@/lib/strayboy/sprite";
import { deriveStreetView } from "@/lib/strayboy/pet-view";
import { useAgentState } from "@/hooks/useAgentState";
import { usePets } from "@/hooks/usePets";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { GRUMPY_MS, usePatStreak } from "@/hooks/usePatStreak";
import type { PatReaction } from "@/hooks/usePatStreak";
import { DialogBox } from "@/components/strayboy/DialogBox";
import { HudBar } from "@/components/strayboy/HudBar";
import { HeartBurst } from "@/components/strayboy/HeartBurst";
import { PixelStage } from "@/components/strayboy/PixelStage";
import { PetSprite } from "@/components/strayboy/PetSprite";
import { WanderLog } from "@/components/strayboy/WanderLog";
import { DEMO_PET, DEMO_STATE, demoEventStream } from "@/lib/strayboy/demo";

/** 「让它去溜达」需 POST /api/walk（spec Decision 8，动 CP 侧须持机人同意）——落地前按钮不上。 */
const SHOW_WANDER_BUTTON = false;
const PAT_LINE_POOL = ["喵。", "呼噜呼噜……", "再摸就要收费了。", "唔，就准你摸一下。"];
const JOY_LINE_POOL = ["哇，连环摸！", "呼噜呼噜呼噜——", "本猫今天就原谅世界。"];
const GRUMPY_LINE_POOL = ["够了！爪子收回去！", "再拍真咬你了啊。"];
const SLEEP_LINE = "Zzz……（尾巴动了动，没醒）";
const PAT_ANIM_MS = 420;

/**
 * 街角交互体（客户端）：像素夜城 + 活猫 + HUD 三墨条 + 拍拍 + WanderLog。
 * 数据 = CP API + SSE；web 不写 agent 数据；?demo=1 时夹具数据替换（页面有 DEMO 徽标）。
 */
export function StreetCorner({ contract, demo = false }: { contract: SpriteContract; demo?: boolean }) {
  const live = useTenantEvents({ enabled: !demo });
  const liveState = useAgentState({ refreshSignal: live.refreshSignal, realtimeConnected: live.connected, enabled: !demo });
  const livePets = usePets();
  const pet = demo ? DEMO_PET : livePets.pets[0];
  const connected = demo || live.connected;
  const state = demo ? DEMO_STATE : liveState.state;

  const [wandering, setWandering] = useState(false);
  const [dialog, setDialog] = useState("本猫出门找货，你看家。");
  const [hearts, setHearts] = useState(0);
  const [grumpyOn, setGrumpyOn] = useState(false);
  const [overrideAnim, setOverrideAnim] = useState<"pat" | "joy" | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // 演示 SSE 流：8s 出门/回家切换
  useEffect(() => {
    if (!demo) return;
    return demoEventStream((type) => {
      setWandering(type === "worker_started");
      setDialog(type === "worker_started" ? "溜了溜了，城里见。" : "叼到点好货，寄回来了。");
    });
  }, [demo]);

  // SSE 事件 → 出屏/回家演出（worker_started 出门；终态回家）
  useEffect(() => {
    if (!live.lastEvent) return;
    if (live.lastEvent.type === "worker_started") {
      setWandering(true);
      setDialog("溜了溜了，城里见。");
    } else if (live.lastEvent.type === "worker_succeeded") {
      setWandering(false);
      setDialog("叼到点好货，寄回来了。");
    } else if (live.lastEvent.type === "worker_failed" || live.lastEvent.type === "worker_timeout") {
      setWandering(false);
      setDialog("……今天城里风大，改天再来。");
    }
  }, [live.lastEvent]);

  const { onPat, reset } = usePatStreak();

  const pat = (): void => {
    if (view.sleeping) {
      setDialog(SLEEP_LINE);
      return;
    }
    const reaction: PatReaction = onPat();
    setHearts((n) => n + 1);
    const lines = reaction === "grumpy" ? GRUMPY_LINE_POOL
      : reaction === "joy" ? JOY_LINE_POOL : PAT_LINE_POOL;
    setDialog(lines[Math.floor(Math.random() * lines.length)]);
    if (reaction === "grumpy") {
      setGrumpyOn(true);
      reset();
      setTimeout(() => setGrumpyOn(false), GRUMPY_MS);
      return;
    }
    setOverrideAnim(reaction);
    setTimeout(() => setOverrideAnim(null), PAT_ANIM_MS);
  };

  const view = deriveStreetView(state, pet, now, wandering);
  const onStreet = !view.away && !view.sleeping;
  const anim = grumpyOn && onStreet
    ? "grumpy"
    : overrideAnim && onStreet ? overrideAnim : view.anim;

  return (
    <div className="sb mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <PixelStage onStreet={!view.away} demo={demo}>
        {!view.away && (
          <button type="button" aria-label={`拍拍${pet.name}`} className="cursor-pointer" onClick={pat}>
            <PetSprite contract={contract} anim={anim} scale={3} hungry={view.hungry && anim === "idle"} />
          </button>
        )}
        {hearts > 0 && <HeartBurst key={hearts} />}
      </PixelStage>

      <div className="flex items-center justify-between">
        <span className="border-2 border-[var(--ink)] bg-[var(--paper)] px-2 py-1 font-ps2p text-xs text-[var(--ink)]">
          LV{view.level} · {pet.name}
        </span>
        <span className="font-vt323 text-[20px] text-[var(--curb)]">
          {demo ? "DEMO FEED" : connected ? "SSE LIVE" : "SSE OFF · 5s 轮询"}
        </span>
      </div>

      {/* HUD 三墨条（spec Decision 6：饥饿↔精力反向 / 无聊 / 心情↔脾气反向）；心情高分=好，低值才告警 */}
      <div className="flex flex-col gap-1.5 border-2 border-black bg-[var(--panel)] p-3 shadow-[4px_4px_0_#000]">
        <HudBar label="饥饿" value={view.bars.hunger} warnAt={80} />
        <HudBar label="无聊" value={view.bars.boredom} warnAt={80} />
        <HudBar label="心情" value={view.bars.mood} warnBelow={20} />
      </div>

      <DialogBox name={pet.name} text={dialog} />

      <WanderLog history={state?.wanderHistory ?? []} />

      {SHOW_WANDER_BUTTON && (
        <button type="button" className="sb-shadow border-2 border-black bg-[var(--act)] px-3 py-2 text-[13px] text-[var(--sky)]">
          让它去溜达
        </button>
      )}
    </div>
  );
}
