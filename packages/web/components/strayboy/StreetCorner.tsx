"use client";

import { useEffect, useRef, useState } from "react";
import type { SpriteContract } from "@/lib/strayboy/sprite";
import { deriveStreetView } from "@/lib/strayboy/pet-view";
import { useAgentState } from "@/hooks/useAgentState";
import { usePets } from "@/hooks/usePets";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { DialogBox } from "@/components/strayboy/DialogBox";
import { HudBar } from "@/components/strayboy/HudBar";
import { HeartBurst } from "@/components/strayboy/HeartBurst";
import { PixelStage } from "@/components/strayboy/PixelStage";
import { PetSprite } from "@/components/strayboy/PetSprite";
import { DEMO_PET, DEMO_STATE, demoEventStream } from "@/lib/strayboy/demo";

/** 「让它去溜达」需 POST /api/walk（spec Decision 8，动 CP 侧须持机人同意）——落地前按钮不上。 */
const SHOW_WANDER_BUTTON = false;
/** 连拍判定窗口（ms）：窗口内累计拍数决定差异化反馈（1=pat，2-3=joy，≥4=grumpy 翻脸）。 */
const PAT_COMBO_WINDOW_MS = 1600;
const GRUMPY_STREAK = 4;

const PAT_LINES = ["喵。", "呼噜呼噜……", "再摸就要收费了。", "唔，就准你摸一下。"];
const JOY_LINES = ["哇，连环摸！", "呼噜呼噜呼噜——", "本猫今天就原谅世界。"];
const GRUMPY_LINES = ["够了！爪子收回去！", "再拍真咬你了啊。"];
const SLEEP_LINE = "Zzz……（尾巴动了动，没醒）";

/**
 * 街角（默认 tab，#170 映射）：像素夜城 + 活猫 + HUD 三墨条 + WanderLog + 拍拍。
 * 数据 = CP API（useAgentState/usePets）+ SSE（useTenantEvents）；web 不写 agent 数据。
 */
export function StreetCorner({ contract, demo = false }: { contract: SpriteContract; demo?: boolean }) {
  const live = useTenantEvents();
  const liveState = useAgentState({
    refreshSignal: demo ? 0 : live.refreshSignal,
    realtimeConnected: demo ? true : live.connected,
  });
  const livePets = usePets();
  // 演示模式：夹具替换真实数据（页面带「演示数据」徽标）；SSE 用本地定时流驱动出屏/回场
  const connected = demo || live.connected;
  const state = demo ? DEMO_STATE : liveState.state;
  const pet = demo ? DEMO_PET : livePets.pets[0];
  const lastEvent = demo ? null : live.lastEvent;

  const [wandering, setWandering] = useState(false);
  const [dialog, setDialog] = useState("本猫出门找货，你看家。");
  const [hearts, setHearts] = useState(0);
  const [patStreak, setPatStreak] = useState({ count: 0, at: 0 });
  const [grumpyUntil, setGrumpyUntil] = useState(0);
  // 时钟进 state（React 纯渲染：render 期禁 Date.now()）；30s 一跳，顺带驱动 DAY/N
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const streakRef = useRef(patStreak);
  useEffect(() => {
    streakRef.current = patStreak;
  }, [patStreak]);

  useEffect(() => {
    if (!demo) return;
    return demoEventStream((type) => {
      setWandering(type === "worker_started");
      setDialog(type === "worker_started" ? "溜了溜了，城里见。" : "叼到点好货，寄回来了。");
    });
  }, [demo]);

  // SSE 事件 → 出屏/回家演出（worker_started 出门；终态回家）
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === "worker_started") {
      setWandering(true);
      setDialog("溜了溜了，城里见。");
    } else if (lastEvent.type === "worker_succeeded") {
      setWandering(false);
      setDialog("叼到点好货，寄回来了。");
    } else if (lastEvent.type === "worker_failed" || lastEvent.type === "worker_timeout") {
      setWandering(false);
      setDialog("……今天城里风大，改天再来。");
    }
  }, [lastEvent]);

  if (!pet) {
    return (
      <div className="sb p-6 text-center text-[14px] text-[var(--curb)]">
        还没有猫。去 START 里领养一只（领养仪式随 T1-5 上线）。
      </div>
    );
  }
  const view = deriveStreetView(state, pet, now, wandering);

  const pat = (): void => {
    if (view.sleeping) {
      setDialog(SLEEP_LINE);
      return;
    }
    const t = Date.now();
    const streak = t - streakRef.current.at <= PAT_COMBO_WINDOW_MS ? streakRef.current.count + 1 : 1;
    setPatStreak({ count: streak, at: t });
    setHearts((n) => n + 1);
    if (streak >= GRUMPY_STREAK) {
      setGrumpyUntil(t + 30_000);
      setDialog(GRUMPY_LINES[streak % GRUMPY_LINES.length]);
      return;
    }
    if (streak >= 2) {
      setDialog(JOY_LINES[streak % JOY_LINES.length]);
      return;
    }
    setDialog(PAT_LINES[Math.floor(Math.random() * PAT_LINES.length)]);
  };

  const grumpy = grumpyUntil > now.getTime();
  const anim = grumpy && !view.away && !view.sleeping ? "grumpy" : view.anim;

  return (
    <div className="sb mx-auto flex max-w-3xl flex-col gap-3 p-3">
      {/* 街区主屏 */}
      <PixelStage onStreet={!view.away} demo={demo}>
        {!view.away && (
          <button
            type="button"
            aria-label={`拍拍${pet.name}`}
            className="cursor-pointer"
            onClick={pat}
          >
            <PetSprite contract={contract} anim={anim} scale={3} hungry={view.hungry && anim === "idle"} />
          </button>
        )}
        {hearts > 0 && <HeartBurst key={hearts} />}
      </PixelStage>

      {/* 名牌 + LV（点开属性卡随属性卡票；LV 派生规则已定） */}
      <div className="flex items-center justify-between">
        <span className="border-2 border-[var(--ink)] bg-[var(--paper)] px-2 py-1 font-ps2p text-[8px] text-[var(--ink)]">
          LV{view.level} · {pet?.name ?? "未领养"}
        </span>
        <span className="font-vt323 text-[16px] text-[var(--curb)]">
          {connected ? "SSE LIVE" : "SSE OFF · 5s 轮询"}
        </span>
      </div>

      {/* HUD 三墨条（spec Decision 6：饥饿↔精力反向 / 无聊 / 心情↔脾气反向） */}
      <div className="flex flex-col gap-1.5 border-2 border-black bg-[var(--panel)] p-3 shadow-[4px_4px_0_#000]">
        <HudBar label="饥饿" value={view.bars.hunger} />
        <HudBar label="无聊" value={view.bars.boredom} />
        <HudBar label="心情" value={view.bars.mood} />
      </div>

      {/* 对话框（活体感：状态变化/拍拍换词） */}
      <DialogBox name={pet.name} text={dialog} />

      {/* WanderLog 4 行（游戏 log；历史在 LOG 存档抽屉） */}
      <section aria-label="游荡日志" className="border-2 border-black bg-black p-3 font-vt323 text-[18px] leading-[1.5] text-[var(--ok)]">
        {(state?.wanderHistory ?? []).slice(0, 4).map((step, i) => (
          <p key={i}>&gt; {step.spoke ?? step.thought ?? step.url ?? `${step.tool} 逛了一圈。`}</p>
        ))}
        {(state?.wanderHistory?.length ?? 0) === 0 && <p>&gt; 还没出过门。它在等天黑。</p>}
      </section>

      {SHOW_WANDER_BUTTON && (
        <button type="button" className="sb-shadow border-2 border-black bg-[var(--act)] px-3 py-2 text-[13px] text-[var(--sky)]">
          让它去溜达
        </button>
      )}
    </div>
  );
}
