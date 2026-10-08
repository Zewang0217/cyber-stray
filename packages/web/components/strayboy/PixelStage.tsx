"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NeighborCat, Passerby } from "./StreetLife";
import { useStreetVariant } from "./StreetVariants";
import styles from "./StreetScene.module.css";

const MOON_CELLS = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23]);
const MOON_PHASES = [
  { name: "满月", shadow: 0 }, { name: "亏凸月", shadow: 1 },
  { name: "下弦月", shadow: 2 }, { name: "残月", shadow: 3 },
  { name: "新月", shadow: 4 }, { name: "娥眉月", shadow: 3 },
  { name: "上弦月", shadow: 2 }, { name: "盈凸月", shadow: 1 },
] as const;
const CORNERS = ["书店门口", "住民小巷", "街角花园"] as const;
const GREET_INTERVAL_MS = 45_000;

/** 美术底图上的可交互窗灯；只在用户操作后覆盖玻璃，保持原图的初始细节。 */
function ShopWindow({ daytime }: { daytime: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const lit = override ?? !daytime;
  return <button type="button" aria-label={`书店窗灯，${lit ? "亮" : "灭"}，点按切换`} aria-pressed={lit}
    onClick={() => setOverride(!lit)} className={`${styles.hotspot} ${styles.window}`}>
    {override !== null && <span aria-hidden className={lit ? styles.windowLit : styles.windowShade}>
      {!lit && Array.from({ length: 8 }, (_, i) => <b key={i} />)}
    </span>}
  </button>;
}

/** 透明生图小物件复用在每日街角布置中，与背景共享美术风格。 */
function StreetPlanter({ second = false }: { second?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/scenes/street-v1/planter.webp" alt="" width={36} height={36}
    className={`${styles.prop} ${styles.planter} ${second ? styles.secondPlanter : ""}`} />;
}

/** 两段热气与一次招牌暗闪共用慢周期，错开强调；不依赖宠物素材或定时器。 */
function StreetAtmosphere({ daytime }: { daytime: boolean }) {
  return <div aria-hidden data-scene-atmosphere className={styles.atmosphere}>
    <span className={styles.coffeeCup} />
    <span data-cafe-steam className={styles.cafeSteam}><b /><b /><b /></span>
    {!daytime && <span data-cafe-sign className={styles.signDimmer} />}
  </div>;
}

/** 像素夜城：生成场景底图 + 同坐标交互层，宠物始终是独立的实时活体。 */
export function PixelStage({ children, onStreet, demo, daytime = false, onPasserbyGreet }: {
  children: ReactNode; onStreet: boolean; demo?: boolean; daytime?: boolean; onPasserbyGreet?: () => void;
}) {
  const [phase, setPhase] = useState(0);
  const [steam, setSteam] = useState(0);
  const [artError, setArtError] = useState<string | null>(null);
  const variant = useStreetVariant();
  const light = daytime ? "day" : "night";
  const moon = MOON_PHASES[phase];
  // SSR 图片可能在 hydration 前就失败，挂载时补查真实解码状态，避免漏掉 error 事件。
  const verifyArt = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setArtError(light);
  }, [light]);
  useEffect(() => {
    if (!onPasserbyGreet) return;
    const id = setInterval(() => { if (onStreet && !daytime) onPasserbyGreet(); }, GREET_INTERVAL_MS);
    return () => clearInterval(id);
  }, [onPasserbyGreet, onStreet, daytime]);
  return (
    <section role="region" aria-label="街角场景" data-light={light} className={styles.stage}>
      <div className={styles.caption}>
        <b aria-hidden /><span>{variant === null ? "街角" : CORNERS[variant]}</span>
        <small>· {daytime ? "日光正好" : "夜灯还亮着"}</small>
      </div>
      {demo && <span className="absolute right-2 top-3 z-10 border border-[var(--neon)] bg-[var(--sky)] px-1 font-ps2p text-xs text-[var(--neon)]">DEMO</span>}
      <div className={styles.world}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={verifyArt} key={`art-${light}`} src={`/scenes/street-v1/${light}.webp`} alt="" data-scene-art={light}
          width={768} height={512} className={styles.art} draggable={false} fetchPriority="high"
          onError={() => setArtError(light)} onLoad={() => setArtError(null)} />
        {artError !== light && <StreetAtmosphere key={`atmosphere-${light}`} daytime={daytime} />}
        <ShopWindow key={`window-${light}`} daytime={daytime} />
        {!daytime && <button type="button" aria-label={`月亮，当前${moon.name}，点按换相`}
          onClick={() => setPhase((p) => (p + 1) % MOON_PHASES.length)} className={`${styles.hotspot} ${styles.moon}`}>
          {Array.from({ length: 25 }, (_, i) => <b key={i} aria-hidden data-lit={MOON_CELLS.has(i) && i % 5 >= moon.shadow} />)}
        </button>}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {variant === 0 && <span className={`${styles.prop} ${styles.notice}`}><b /><b /><b /></span>}
          {variant === 1 && <StreetPlanter />}
          {variant === 2 && <><StreetPlanter /><StreetPlanter second /></>}
        </div>
        {!daytime && <>
          <NeighborCat style={{ left: "76%", bottom: "88%" }} />
          <Passerby delay="0s" duration="38s" />
        </>}
        <button type="button" aria-label="路缘水沟盖，点按冒蒸汽" onClick={() => setSteam((n) => n + 1)} className={`${styles.hotspot} ${styles.drain}`} />
        {steam > 0 && <span key={steam} aria-hidden data-scene-steam className={`sb-steam ${styles.steam}`}><b /><b /><b /></span>}
        <div className={styles.petLayer}>{children}</div>
        {!onStreet && <div className={styles.away}>溜达中 · 去城里找货了</div>}
      </div>
      {artError === light && <p role="alert" className={styles.error}>街景加载失败，请刷新页面重试。宠物与其他功能仍可使用。</p>}
    </section>
  );
}
