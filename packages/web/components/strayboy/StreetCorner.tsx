"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { AttrCard } from "@/components/strayboy/AttrCard";
import { PASSERBY_LINES } from "@/components/strayboy/StreetLife";
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
  const [attrCardOpen, setAttrCardOpen] = useState(false);
  const [coat, setCoat] = useState<"orange" | "black" | "calico">("orange");
  const [attract, setAttract] = useState(false);
  const [mailman, setMailman] = useState(false);
  const patGrumpyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [neonTopic, setNeonTopic] = useState<string | null>(null);
  const lastActivityRef = useRef(0);
  const prevLevel = useRef<number | null>(null);
  const { onPat, reset } = usePatStreak();
  // /footprint 重定向 ?drawer=log → 自动开 LOG 存档抽屉
  const openDrawerViaRoute = useSearchParams().get("drawer") === "log";
  useEffect(() => {
    if (openDrawerViaRoute) setDrawerOpen(true);
  }, [openDrawerViaRoute]);

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

  // 毛色皮肤（delight B12）：初始读 + CoatPicker 事件刷新
  useEffect(() => {
    const raw = window.localStorage.getItem("sb_coat");
    if (raw === "black" || raw === "calico") setCoat(raw);
    const onCoat = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "black" || id === "calico" || id === "orange") setCoat(id);
    };
    window.addEventListener("sb-coat", onCoat);
    return () => window.removeEventListener("sb-coat", onCoat);
  }, []);

  // 霓虹换牌（delight B13）：图鉴 No.1 更替时写入，此处短暂换招牌文案
  useEffect(() => {
    const raw = window.localStorage.getItem("sb_neon_topic");
    const until = Number(window.localStorage.getItem("sb_neon_until") ?? 0);
    if (raw && until > Date.now()) setNeonTopic(raw);
  }, []);

  // attract mode（delight B10）：5min 无交互进街机待机画面；任意交互退出
  useEffect(() => {
    const idle = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 300_000) setAttract(true);
    }, 15_000);
    const wake = (): void => {
      lastActivityRef.current = Date.now();
      setAttract(false);
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearInterval(idle);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  // 邮差动画（delight B9）：回家事件触发剪影走场
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== "worker_succeeded") return;
    setMailman(true);
    const id = setTimeout(() => setMailman(false), 2600);
    return () => clearTimeout(id);
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

  // 路人偶遇台词（#212）：稳定引用——内联箭头会让 PixelStage 的 45s interval
  // 每次渲染被 clear+重建，台词永不触发（评审 HIGH-1）。不回写 lastActivityRef：
  // 它是「用户输入」语义，环境事件刷新会杀掉待机小剧场与 attract mode（评审 MEDIUM-3）
  const onPasserbyGreet = useCallback((): void => {
    const line = PASSERBY_LINES[Math.floor(Math.random() * PASSERBY_LINES.length)];
    setDialog(line);
  }, []);

  const pat = useCallback((): void => {
    lastActivityRef.current = Date.now();
    setAttract(false);
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
      // ref 化：快速连拍不叠多个定时器（先到的提前掐掉后一次的 30s 臭脸，评审 C-minor4）
      clearTimeout(patGrumpyTimer.current);
      patGrumpyTimer.current = setTimeout(() => setGrumpyOn(false), GRUMPY_MS);
      return;
    }
    setOverrideAnim(reaction);
    setTimeout(() => setOverrideAnim(null), PAT_ANIM_MS);
  }, [view.sleeping, onPat, reset]);

  const onStreet = !view.away && !view.sleeping;

  // #218 失败态 = 瞬时覆盖：连续失败 ≥3 触发一段 grumpy（数值态 bored 才是常态，
  // 二者分离——失败过几天不等于从此臭脸）
  const failures = state?.consecutiveFailures ?? 0;
  useEffect(() => {
    if (failures < 3) return;
    setGrumpyOn(true);
    const id = setTimeout(() => setGrumpyOn(false), GRUMPY_MS);
    // 复位放 cleanup 而非 <3 分支：回落（游荡成功清零）时 cleanup 清定时器并复位，
    // 滞留路径封死（评审 HIGH-1）；failures 从未 ≥3 则 cleanup 不注册，
    // 不压制 #190 时间机器记仇的 grumpy（复审 MEDIUM-1）
    return () => {
      clearTimeout(id);
      setGrumpyOn(false);
    };
  }, [failures]);

  const theaterAnim = theater && onStreet ? theater.anim : null;
  const anim = grumpyOn && onStreet
    ? "grumpy"
    : overrideAnim && onStreet ? overrideAnim
    : theaterAnim ?? view.anim;

  // #218 随机 joy 闪烁：低频（约 2 分钟一次四成概率）、仅合成后站街 idle——
  // 打盹/无聊 grumpy 不被 joy 打断（评审 MEDIUM-1）；updater 内不带副作用（LOW-1）。
  // anim 变化即重挂 interval（覆盖期间不计时，回 idle 重新低频起算）
  useEffect(() => {
    if (anim !== "idle") return;
    const id = setInterval(() => {
      if (Math.random() < 0.4) {
        setOverrideAnim("joy");
        setTimeout(() => setOverrideAnim(null), PAT_ANIM_MS);
      }
    }, 120_000);
    return () => clearInterval(id);
  }, [anim]);

  return (
    <div className="sb mx-auto flex max-w-3xl flex-col gap-3 p-3 lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="lg:col-start-1 lg:row-start-1">
      <PixelStage
        onStreet={!view.away}
        demo={demo}
        daytime={!view.sleeping}
        onPasserbyGreet={onPasserbyGreet}
      >
        {!view.away && (
          <button type="button" aria-label={`拍拍${pet.name}`} className="relative cursor-pointer" onClick={pat}>
            <PetSprite contract={contract} anim={anim} scale={3} hungry={view.hungry && (anim === "idle" || view.napping)} coat={coat} />
            {/* 打盹角标（#218）：非睡眠期的精力低打盹，复用 sleep 帧 + zZ 与 #91 睡眠期区分 */}
            {view.napping && anim === "sleep" && (
              <span aria-hidden className="sb-blink absolute -top-2 right-0 font-vt323 text-[13px] leading-none text-[var(--curb)]">
                zZ
              </span>
            )}
          </button>
        )}
        {hearts > 0 && <HeartBurst key={hearts} />}
        {mailman && (
          <span aria-hidden className="sb-mailman absolute bottom-[26px] z-[5] text-[14px] leading-none text-[var(--ink)]">
            ▟
          </span>
        )}
      </PixelStage>
      </div>
      {/* 霓虹换牌（delight B13）：图鉴 No.1 更替时短暂换文案 */}
      {neonTopic && (
        <p aria-hidden className="font-ps2p absolute right-6 top-6 z-[6] text-[10px] text-[var(--neon)] sb-blink">
          {neonTopic}
        </p>
      )}
      {attract && (
        <div className="fixed inset-0 z-[75] flex flex-col items-center justify-center gap-6 bg-[var(--sky)]" onClick={() => setAttract(false)}>
          <p className="font-ps2p text-sm text-[var(--neon)] sb-blink">STREET MODE</p>
          <PetSprite contract={contract} anim="walk" scale={3} coat={coat} />
          <p className="text-[12px] text-[var(--curb)]">点按任意处回到掌机</p>
        </div>
      )}

      <div className="flex items-center justify-between lg:col-start-1 lg:row-start-2">
        <button
          type="button"
          onClick={() => setAttrCardOpen(true)}
          aria-label="查看角色属性卡"
          className={`border-2 border-[var(--ink)] bg-[var(--paper)] px-2 py-1 font-ps2p text-xs text-[var(--ink)] ${lvFlash ? "sb-blink" : ""}`}
        >
          LV{view.level} · {pet.name}
        </button>
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

      {/* HUD 三墨条 + 心情标签（ADR-0013 §4 / #217：后端原始值零换算，精力高=好；
          心情 = 枚举原文非分数；state 缺失显未知态不伪装健康。lg 桌面入右列） */}
      <div className="flex flex-col gap-1.5 border-2 border-black bg-[var(--panel)] p-3 shadow-[4px_4px_0_#000] lg:col-start-2 lg:row-start-1">
        <HudBar label="精力" value={view.bars.energy} warnBelow={20} />
        <HudBar label="无聊" value={view.bars.boredom} warnAt={80} />
        <HudBar label="脾气" value={view.bars.temper} warnAt={80} />
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[12px] text-[var(--paper)]">心情</span>
          <span className="border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-0.5 font-vt323 text-[14px] uppercase text-[var(--paper)]">
            {view.mood ?? "--"}
          </span>
        </div>
      </div>

      <div className="lg:col-start-2 lg:row-start-2">
        <DialogBox name={pet.name} text={dialog} />
      </div>

      <div className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
        <WanderLog history={state?.wanderHistory ?? []} />
      </div>

      {SHOW_WANDER_BUTTON && (
        <button type="button" className="sb-shadow border-2 border-black bg-[var(--act)] px-3 py-2 text-[13px] text-[var(--sky)]">
          让它去溜达
        </button>
      )}

      <LogDrawer open={drawerOpen} onOpenChange={setDrawerOpen} demo={demo} />
      {attrCardOpen && (
        <AttrCard pet={pet} state={state} level={view.level} onClose={() => setAttrCardOpen(false)} />
      )}
    </div>
  );
}
