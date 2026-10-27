"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpriteContract } from "@cyber-stray/shared/sprite";
import { HeartBurst } from "@/components/strayboy/HeartBurst";
import { PetSprite } from "@/components/strayboy/PetSprite";
import { PixelStage } from "@/components/strayboy/PixelStage";
import styles from "./landing.module.css";

const PAT_LINES = [
  "呼噜呼噜……手劲不错，准许再拍两下。",
  "别拍了别拍了，毛要起静电了。",
  "心情 +1。这手感，值一条明信片。",
];
const ROAM_LINE = "出去转转，无聊值高得爪痒。抓到好货就钉你墙上！";
const BACK_LINE = "回来了！爪子跑酸了，明信片已寄出，往下翻查收。";
const HELLO_LINE = "你来了？这条街现在归我逛。点一下，看我出门找点新鲜的。";
const WANDER = { log1: 1500, log2: 2600, home: 5200, land: 6700, again: 14000 };
const TYPE_MS = 33;

export function StreetStage({ contract }: { contract: SpriteContract }) {
  const [anim, setAnim] = useState("idle");
  const [out, setOut] = useState(false);
  const [patjump, setPatjump] = useState(false);
  const [roaming, setRoaming] = useState(false);
  const [text, setText] = useState("");
  const [hearts, setHearts] = useState(0);
  const [logs, setLogs] = useState<string[]>([
    "[22:31] 进食完成 · 精力+2",
    '[22:17] 兴趣「像素游戏」关注度 <b>↑</b>',
  ]);
  const [mood, setMood] = useState(8);
  const [boredom, setBoredom] = useState(7);
  const reduced = useRef(false);
  const timers = useRef<number[]>([]);
  const typeTimer = useRef<number | null>(null);
  const patIdx = useRef(-1);
  const roamingRef = useRef(false);
  const wanderRef = useRef<(auto: boolean) => void>(() => {});

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const say = useCallback((line: string) => {
    if (typeTimer.current !== null) window.clearInterval(typeTimer.current);
    if (reduced.current) {
      setText(line);
      return;
    }
    setText("");
    let i = 0;
    typeTimer.current = window.setInterval(() => {
      setText(line.slice(0, ++i));
      if (i >= line.length && typeTimer.current !== null) {
        window.clearInterval(typeTimer.current);
        typeTimer.current = null;
      }
    }, TYPE_MS);
  }, []);

  const pushLog = useCallback((html: string) => {
    setLogs((prev) => [...prev.slice(-3), html]);
  }, []);

  const wander = useCallback((auto: boolean) => {
    if (roamingRef.current) return;
    if (auto && document.hidden) {
      later(() => wanderRef.current(true), 8000);
      return;
    }
    roamingRef.current = true;
    setRoaming(true);
    setAnim("walk");
    setOut(true);
    say(ROAM_LINE);
    later(() => pushLog('[22:44] 出门 → DDG「像素 独立游戏」→ <b>抓到2条</b>'), WANDER.log1);
    later(() => pushLog("[22:45] 嗅到新鲜货 · 重复率 0.12 → <b>寄明信片</b>"), WANDER.log2);
    later(() => {
      setOut(false);
      pushLog("[22:46] 无聊 72→31 · 回家趴下");
    }, WANDER.home);
    later(() => {
      setAnim("idle");
      roamingRef.current = false;
      setRoaming(false);
      setBoredom((value) => Math.max(0, value - 3));
      say(BACK_LINE);
    }, WANDER.land);
    later(() => wanderRef.current(true), WANDER.again);
  }, [later, pushLog, say]);

  useEffect(() => {
    wanderRef.current = wander;
  }, [wander]);

  const pat = useCallback(() => {
    if (out) {
      say("它正溜达呢，回来再拍。");
      return;
    }
    setAnim("pat");
    setPatjump(true);
    setHearts((value) => value + 1);
    later(() => {
      setPatjump(false);
      setAnim("idle");
    }, 400);
    setMood((value) => Math.min(10, value + 1));
    patIdx.current = (patIdx.current + 1) % PAT_LINES.length;
    say(PAT_LINES[patIdx.current]);
  }, [out, later, say]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const onMq = () => { reduced.current = mq.matches; };
    mq.addEventListener("change", onMq);
    say(HELLO_LINE);
    if (!mq.matches) later(() => wanderRef.current(true), 6000);
    const pendingTimers = timers.current;
    const pendingType = typeTimer;
    return () => {
      mq.removeEventListener("change", onMq);
      pendingTimers.forEach(window.clearTimeout);
      if (pendingType.current !== null) window.clearInterval(pendingType.current);
    };
  }, [later, say]);

  return (
    <div className={styles.stage}>
      <div className={styles.stageLabel}>
        <span className={styles.mono}>INTERACTIVE STREET</span>
        <span className={styles.vt}>POWER <i aria-hidden="true" /></span>
      </div>
      <div className={styles.sceneFrame}>
        <PixelStage onStreet={!out}>
          {!out && (
            <button
              type="button"
              className={`${styles.cat}${patjump ? ` ${styles.patjump}` : ""}`}
              aria-label="拍拍年糕"
              onClick={pat}
            >
              <PetSprite contract={contract} anim={anim} scale={3} />
            </button>
          )}
          {hearts > 0 && <HeartBurst key={hearts} />}
        </PixelStage>
      </div>

      <div className={styles.hud}>
        <div className={styles.row1}>
          <span className={`${styles.lv} ${styles.ps2}`}>LV.7</span>
          <span className={`${styles.petname} ${styles.dot}`}>年糕 · {mood >= 8 ? "得劲" : "一般"}</span>
          <span className={styles.btns}>
            <button type="button" className={`${styles.pbtn} ${styles.green}`} onClick={pat}>拍拍它</button>
            <button type="button" className={`${styles.pbtn} ${styles.blue}`} disabled={roaming} onClick={() => wander(false)}>
              {roaming ? "溜达中…" : "让它去溜达"}
            </button>
          </span>
        </div>
        <div className={styles.meters}>
          <div className={styles.meter}><span className={styles.lbl}><span>精力</span><i>充足</i></span><Segments filled={8} cls="f1" /></div>
          <div className={styles.meter}><span className={styles.lbl}><span>无聊</span><i>{boredom > 5 ? "想出门" : "还行"}</i></span><Segments filled={boredom} cls="f2" /></div>
          <div className={styles.meter}><span className={styles.lbl}><span>脾气</span><i>好说话</i></span><Segments filled={2} cls="f3" /></div>
        </div>
      </div>

      <div className={styles.stageLower}>
        <div className={styles.dlg}>
          <span className={`${styles.who} ${styles.dot}`}>&lt;年糕&gt;</span>
          <p className={styles.txt} aria-live="polite">{text}</p>
          <span className={styles.more} aria-hidden="true">▼</span>
        </div>
        <div className={styles.log} aria-label="游荡记录">
          <span className={`${styles.logTitle} ${styles.mono}`}>WANDER.LOG</span>
          {logs.map((line, index) => (
            <p key={`${index}-${line}`} dangerouslySetInnerHTML={{ __html: line + `<span class="${styles.cur}">■</span>` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Segments({ filled, cls }: { filled: number; cls: string }) {
  return (
    <div className={styles.segs} aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => <b key={index} className={index < filled ? styles[cls] : undefined} />)}
    </div>
  );
}
