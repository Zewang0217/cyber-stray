"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpriteContract } from "@/lib/strayboy/sprite";
import { deriveStreetView } from "@/lib/strayboy/pet-view";
import { useAgentState } from "@/hooks/useAgentState";
import { usePets } from "@/hooks/usePets";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { GRUMPY_MS, usePatStreak } from "@/hooks/usePatStreak";
import type { PatReaction } from "@/hooks/usePatStreak";
import { vibrate } from "@/lib/strayboy/haptics";
import { DialogBox } from "@/components/strayboy/DialogBox";
import { HudBar } from "@/components/strayboy/HudBar";
import { HeartBurst } from "@/components/strayboy/HeartBurst";
import { LogDrawer } from "@/components/strayboy/LogDrawer";
import { PixelStage } from "@/components/strayboy/PixelStage";
import { PetSprite } from "@/components/strayboy/PetSprite";
import { WanderLog } from "@/components/strayboy/WanderLog";
import { AdoptionRitual } from "@/components/strayboy/AdoptionRitual";
import { DEMO_PET, DEMO_STATE, demoEventStream } from "@/lib/strayboy/demo";
import type { AgentState } from "@/lib/types";
import type { PetRecord } from "@/lib/strayboy/pet-view";

/** 「让它去溜达」需 POST /api/walk（spec Decision 8，动 CP 侧须持机人同意）——落地前按钮不上。 */
const SHOW_WANDER_BUTTON = false;
const PAT_LINE_POOL = ["喵。", "呼噜呼噜……", "再摸就要收费了。", "唔，就准你摸一下。"];
const JOY_LINE_POOL = ["哇，连环摸！", "呼噜呼噜呼噜——", "本猫今天就原谅世界。"];
const GRUMPY_LINE_POOL = ["够了！爪子收回去！", "再拍真咬你了啊。"];
const SLEEP_LINE = "Zzz……（尾巴动了动，没醒）";
const PAT_ANIM_MS = 420;
/** 待机小剧场：无交互 90s 后猫自己演（delight A1）。 */
const IDLE_THEATER_MS = 90_000;
const THEATER = [
  { anim: "joy" as const, line: "（追自己的尾巴，转了两圈）" },
  { anim: "think" as const, line: "（盯着某扇窗，若有所思）" },
  { anim: "walk" as const, line: "（沿着路缘踱步，假装在巡逻）" },
];
const GRUMPY_KEY = "sb_grumpy_until";

/**
 * 街角（默认 tab）：外层门控——加载态 / 领养仪式 / 主交互体三分。
 * 数据 = CP API + SSE；web 不写 agent 数据；?demo=1 夹具替换（DEMO 徽标标注）。
 */
export function StreetCorner({ contract, demo = false }: { contract: SpriteContract; demo?: boolean }) {
  const live = useTenantEvents({ enabled: !demo });
  const liveState = useAgentState({ refreshSignal: live.refreshSignal, realtimeConnected: live.connected, enabled: !demo });
  const livePets = usePets({ enabled: !demo });
  const [adoptedGate, setAdoptedGate] = useState(false);

  if (demo) {
    return (
      <StreetCornerMain
        contract={contract}
        demo
        pet={DEMO_PET}
        state={DEMO_STATE}
        connected
        lastEvent={null}
      />
    );
  }
  if (!livePets.isLoaded) {
    return <div className="sb p-6 text-center text-[13px] text-[var(--curb)]">开机自检中……</div>;
  }
  if (adoptedGate || !livePets.pets[0]) {
    return (
      <AdoptionRitual
        contract={contract}
        adopt={async (input) => {
          const result = await livePets.adopt(input);
          if (result) setAdoptedGate(true);
          return result;
        }}
        adopting={livePets.adopting}
        adoptError={livePets.error}
        onAdopted={() => setAdoptedGate(false)}
      />
    );
  }
  return (
    <StreetCornerMain
      contract={contract}
      demo={demo}
      pet={livePets.pets[0]}
      state={demo ? DEMO_STATE : liveState.state}
      connected={demo || live.connected}
      lastEvent={demo ? null : live.lastEvent}
    />
  );
}

interface MainProps {
  contract: SpriteContract;
  demo: boolean;
  pet: PetRecord;
  state: AgentState | null;
  connected: boolean;
  lastEvent: ReturnType<typeof useTenantEvents>["lastEvent"];
}

/** 街角主交互体：hooks 全部在此层早于任何 return（规则内），门控已在外层完成。 */
function StreetCornerMain({ contract, demo, pet, state, connected, lastEvent }: MainProps) {
  const [wandering, setWandering] = useState(false);
  const [dialog, setDialog] = useState("本猫出门找货，你看家。");
  const [hearts, setHearts] = useState(0);
  const [grumpyOn, setGrumpyOn] = useState(false);
  const [overrideAnim, setOverrideAnim] = useState<"pat" | "joy" | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theater, setTheater] = useState<(typeof THEATER)[number] | null>(null);
  const [lvFlash, setLvFlash] = useState(false);
  const lastActivityRef = useRef(0);
  const prevLevel = useRef<number | null>(null);
  const { onPat, reset } = usePatStreak();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // 待机小剧场（delight A1）：90s 无交互猫自己演 + 自言自语；拍拍复位
  useEffect(() => {
    let idx = 0;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current < IDLE_THEATER_MS) return;
      const t = THEATER[idx % THEATER.length];
      idx += 1;
      setTheater(t);
      setDialog(t.line);
    }, IDLE_THEATER_MS);
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

  // 真实 SSE 事件 → 出屏/回家演出
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

  // 回滚记仇旗标（#190 时间机器写入，街角消费）
  useEffect(() => {
    const raw = window.localStorage.getItem(GRUMPY_KEY);
    const until = raw === null ? 0 : Number(raw);
    if (Number.isFinite(until) && until > Date.now()) {
      setGrumpyOn(true);
      setDialog("唔……回到这一天了。");
      const id = setTimeout(() => setGrumpyOn(false), until - Date.now());
      return () => clearTimeout(id);
    }
  }, []);

  const view = useMemo(
    () => deriveStreetView(state, pet, now, wandering),
    [state, pet, now, wandering],
  );

  // LV 升级（delight A8）：名牌闪 + 对话框
  useEffect(() => {
    if (prevLevel.current === null) {
      prevLevel.current = view.level;
      return;
    }
    if (view.level > prevLevel.current) {
      setLvFlash(true);
      setDialog(`升级！LV${view.level}——本猫出息了。`);
      const id = setTimeout(() => setLvFlash(false), 1600);
      prevLevel.current = view.level;
      return () => clearTimeout(id);
    }
    prevLevel.current = view.level;
  }, [view.level]);

  const pat = useCallback((): void => {
    lastActivityRef.current = Date.now();
    setTheater(null);
    vibrate(15);
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
  }, [view.sleeping, onPat, reset]);

  const onStreet = !view.away && !view.sleeping;
  const theaterAnim = theater && onStreet ? theater.anim : null;
  const anim = grumpyOn && onStreet
    ? "grumpy"
    : overrideAnim && onStreet ? overrideAnim
    : theaterAnim ?? view.anim;

  return (
    <div className="sb mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <PixelStage onStreet={!view.away} demo={demo} daytime={!view.sleeping}>
        {!view.away && (
          <button type="button" aria-label={`拍拍${pet.name}`} className="cursor-pointer" onClick={pat}>
            <PetSprite contract={contract} anim={anim} scale={3} hungry={view.hungry && view.anim === "idle"} />
          </button>
        )}
        {hearts > 0 && <HeartBurst key={hearts} />}
      </PixelStage>

      <div className="flex items-center justify-between">
        <span className={`border-2 border-[var(--ink)] bg-[var(--paper)] px-2 py-1 font-ps2p text-xs text-[var(--ink)] ${lvFlash ? "sb-blink" : ""}`}>
          LV{view.level} · {pet.name}
        </span>
        {/* 存档抽屉入口（/footprint 重定向至此） */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="border-2 border-[var(--curb)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--paper)]"
        >
          LOG · 存档
        </button>
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

      <LogDrawer open={drawerOpen} onOpenChange={setDrawerOpen} demo={demo} />
    </div>
  );
}
