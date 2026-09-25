"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animationCss, frameStyle } from "@cyber-stray/shared/sprite";
import type { SpriteContract } from "@cyber-stray/shared/sprite";

/**
 * Hero 街区舞台：产品核心闭环的实况演示（编排取自 docs/design-v3/demo.html
 * 验收基准——猫出门游荡 → 日志滚动 → 明信片寄出 → 回家）。
 * 纪律：sprite 帧动画纯 CSS steps()（shared/sprite 契约驱动，零逐帧 JS）；
 * 位移只有 linear；页签不可见时停帧（motion.md §5）；reduced-motion 关自动
 * 循环与打字机，交互按钮仍可用（即时反馈，无过渡）。
 */

/** 固定种子 LCG：星星/窗灯 SSR 与客户端一致，且每次访问城市长得一样 */
function makeRnd(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const PAT_LINES = [
  "呼噜呼噜……手劲不错，准许再拍两下。",
  "别拍了别拍了，毛要起静电了。",
  "心情 +1。这手感，值一条明信片。",
];
const ROAM_LINE = "出去转转，无聊值高得爪痒。抓到好货就钉你墙上！";
const BACK_LINE = "回来了！爪子跑酸了，明信片已寄出，往下翻查收。";
const HELLO_LINE = "你来了？正好帮我看着家，我这就出门去互联网上溜达。";

/** 游荡编排时刻表（ms，demo.html 同款节奏；again = 一轮周期） */
const WANDER = { log1: 1500, log2: 2600, home: 5200, land: 6700, again: 14000 };

const TYPE_MS = 33;

interface Heart {
  id: number;
  left: string;
  top: string;
  color: string;
}

export function StreetStage({ contract }: { contract: SpriteContract }) {
  const [anim, setAnim] = useState("idle");
  const [out, setOut] = useState(false);
  const [back, setBack] = useState(false);
  const [patjump, setPatjump] = useState(false);
  const [roaming, setRoaming] = useState(false);
  const [text, setText] = useState("");
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [logs, setLogs] = useState<string[]>([
    "[22:31] 进食完成 · 心情+2",
    '[22:17] 兴趣「像素游戏」关注度 <b>↑</b>',
  ]);
  const [mood, setMood] = useState(8);
  const [boredom, setBoredom] = useState(7);

  const reduced = useRef(false);
  const timers = useRef<number[]>([]);
  const typeTimer = useRef<number | null>(null);
  const heartId = useRef(0);
  const patIdx = useRef(-1);
  // 游荡守卫走 ref 而非 state：定时器闭包里的 state 是过期快照，
  // 自动循环与手动触发可能叠出两轮游荡（ref 读到的永远是现值）
  const roamingRef = useRef(false);
  // 自动循环的递归调用经 ref 转发：直接在 useCallback 体内引用自身会被
  // react-hooks/immutability 判为声明前访问（且闭包自引用易随重构腐化）
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

  // 依赖全部稳定（later/pushLog/say 皆空依赖），wander 身份恒定：
  // 定时器链里递归引用自身也不会拿到过期闭包
  const wander = useCallback(
    (auto: boolean) => {
      if (roamingRef.current) return;
      // 自动循环在页签不可见时顺延，不做后台空转
      if (auto && document.hidden) {
        later(() => wanderRef.current(true), 8000);
        return;
      }
      roamingRef.current = true;
      setRoaming(true);
      setBack(false);
      setAnim("walk");
      setOut(true);
      say(ROAM_LINE);
      later(() => pushLog('[22:44] 出门 → DDG「像素 独立游戏」→ <b>抓到2条</b>'), WANDER.log1);
      later(() => pushLog("[22:45] 嗅到新鲜货 · 重复率 0.12 → <b>寄明信片</b>"), WANDER.log2);
      later(() => {
        setOut(false);
        setBack(true);
        pushLog("[22:46] 无聊 72→31 · 回家趴下");
      }, WANDER.home);
      later(() => {
        setBack(false);
        setAnim("idle");
        roamingRef.current = false;
        setRoaming(false);
        setBoredom((b) => Math.max(0, b - 3));
        say(BACK_LINE);
      }, WANDER.land);
      later(() => wanderRef.current(true), WANDER.again);
    },
    [later, pushLog, say],
  );

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
    later(() => {
      setPatjump(false);
      setAnim("idle");
    }, 400);
    const colors = ["var(--bad)", "var(--hi)", "var(--ok)"];
    const batch: Heart[] = [0, 1, 2].map((i) => ({
      id: ++heartId.current,
      left: `${30 + Math.random() * 40}%`,
      top: `${10 + Math.random() * 25}%`,
      color: colors[i],
    }));
    setHearts((prev) => [...prev, ...batch]);
    later(() => setHearts((prev) => prev.filter((h) => !batch.includes(h))), 600);
    setMood((m) => Math.min(10, m + 1));
    patIdx.current = (patIdx.current + 1) % PAT_LINES.length;
    say(PAT_LINES[patIdx.current]);
  }, [out, later, say]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const onMq = () => {
      reduced.current = mq.matches;
    };
    const onVisibility = () => {
      document.body.classList.toggle("anim-paused", document.hidden);
    };
    mq.addEventListener("change", onMq);
    document.addEventListener("visibilitychange", onVisibility);
    say(HELLO_LINE);
    if (!mq.matches) later(() => wanderRef.current(true), 6000);
    // cleanup 前拷出 ref 现值（lint：cleanup 执行时 ref 可能已换指向）
    const pendingTimers = timers.current;
    const pendingType = typeTimer;
    return () => {
      mq.removeEventListener("change", onMq);
      document.removeEventListener("visibilitychange", onVisibility);
      document.body.classList.remove("anim-paused");
      pendingTimers.forEach(window.clearTimeout);
      if (pendingType.current !== null) window.clearInterval(pendingType.current);
    };
    // 挂载一次：wander/say 身份恒定，重复执行会重放开机问候
  }, [later, say]);

  // 星星与窗灯：固定种子，SSR/CSR 同值
  const stars = useMemo(() => {
    const rnd = makeRnd(42);
    return Array.from({ length: 34 }, () => ({
      left: `${rnd() * 96}%`,
      top: `${rnd() * 55}%`,
      opacity: 0.4 + rnd() * 0.6,
    }));
  }, []);
  const windows = useMemo(() => {
    const rnd = makeRnd(7);
    const build = (width: number, cols: number, rows: number) => {
      const cells: { left: number; top: number; on: boolean }[] = [];
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
          cells.push({ left: 8 + c * ((width - 16) / cols), top: 10 + r * 22, on: rnd() < 0.62 });
      return cells;
    };
    return { far1: build(120, 4, 6), far2: build(90, 3, 4), near1: build(150, 5, 7) };
  }, []);

  return (
    <div>
      <style>{animationCss(contract)}</style>
      <div className="screen">
        <span className="stage-name dot">年糕 的街区</span>
        <div className="stars">
          {stars.map((s, i) => (
            <i key={i} style={{ left: s.left, top: s.top, opacity: s.opacity }} />
          ))}
        </div>
        <span className="moon" />
        <div className="bld bld-far-1">
          {windows.far1.map((w, i) => (
            <span key={i} className={w.on ? "win" : "win off"} style={{ left: w.left, top: w.top }} />
          ))}
        </div>
        <div className="bld bld-far-2">
          {windows.far2.map((w, i) => (
            <span key={i} className={w.on ? "win" : "win off"} style={{ left: w.left, top: w.top }} />
          ))}
        </div>
        <div className="neon">
          CYBER
          <br />
          STRAY
        </div>
        <div className="bld bld-near-1">
          {windows.near1.map((w, i) => (
            <span key={i} className={w.on ? "win" : "win off"} style={{ left: w.left, top: w.top }} />
          ))}
        </div>
        <span className="lamp" />
        <div className="street" />
        <div
          className={`cat${out ? " out" : ""}${back ? " back" : ""}${patjump ? " patjump" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="拍拍它"
          onClick={pat}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pat();
            }
          }}
        >
          <span className="flip">
            <span className="pixelated" style={frameStyle({ contract, anim, scale: 3 })} />
          </span>
          {hearts.map((h) => (
            <div key={h.id} className="ph" style={{ left: h.left, top: h.top, background: h.color }} />
          ))}
        </div>
      </div>

      <div className="hud">
        <div className="row1">
          <span className="lv ps2">LV.7</span>
          <span className="petname dot">年糕 · 游荡者</span>
          <span className="btns">
            <button type="button" className="pbtn green" onClick={pat}>
              拍拍它
            </button>
            <button type="button" className="pbtn blue" disabled={roaming} onClick={() => wander(false)}>
              {roaming ? "溜达中…" : "让它去溜达"}
            </button>
          </span>
        </div>
        <div className="meters">
          <div className="meter">
            <span className="lbl">
              <span>饥饿</span>
              <i>饱</i>
            </span>
            <Segments filled={7} cls="f1" />
          </div>
          <div className="meter">
            <span className="lbl">
              <span>无聊</span>
              <i>{boredom > 5 ? "想出门" : "还行"}</i>
            </span>
            <Segments filled={boredom} cls="f2" />
          </div>
          <div className="meter">
            <span className="lbl">
              <span>心情</span>
              <i>{mood >= 8 ? "得劲" : "一般"}</i>
            </span>
            <Segments filled={mood} cls="f3" />
          </div>
        </div>
      </div>

      <div className="dlg">
        <span className="who dot">&lt;年糕&gt;</span>
        <p className="txt" aria-live="polite">
          {text}
        </p>
        <span className="more">▼</span>
      </div>

      <div className="log">
        {logs.map((line, i) => (
          // 日志行含 <b> 强调（游荡战果），来源是本文件内的常量模板，非外部输入
          <p key={i} dangerouslySetInnerHTML={{ __html: line + '<span class="cur">■</span>' }} />
        ))}
      </div>
    </div>
  );
}

/** HUD 分段墨条（宪法 §4.4：10 格分段，禁连续进度条） */
function Segments({ filled, cls }: { filled: number; cls: string }) {
  return (
    <div className="segs">
      {Array.from({ length: 10 }, (_, i) => (
        <b key={i} className={i < filled ? cls : undefined} />
      ))}
    </div>
  );
}
