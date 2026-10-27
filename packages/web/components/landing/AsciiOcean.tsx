"use client";

import { useEffect, useRef } from "react";
import styles from "./landing.module.css";

const FRAME_MS = 1000 / 12;
const BODY = [
  "......#####.........",
  "....#########.......",
  "...###########......",
  "#..#############....",
  "###.#############...",
  "#..#############....",
  "...###########......",
  "....#########.......",
  "......#####.........",
];
const TRAIL_CHARS = ["·", "+", "0", "1", "·", ":"];
const FISH = [
  { x: .08, y: .2, vx: 24, vy: 3, pixel: 7, tone: 0, phase: 0 },
  { x: .72, y: .14, vx: -18, vy: 2, pixel: 5, tone: 1, phase: 1 },
  { x: .46, y: .76, vx: 20, vy: -2, pixel: 7, tone: 0, phase: 0 },
  { x: .9, y: .6, vx: -26, vy: -3, pixel: 4, tone: 2, phase: 1 },
  { x: .2, y: .88, vx: 15, vy: -2, pixel: 4, tone: 1, phase: 0 },
  { x: .56, y: .42, vx: -13, vy: 2, pixel: 4, tone: 2, phase: 1 },
];

export function AsciiOcean() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(canvas);
    const tones = [css.getPropertyValue("--curb").trim(), css.getPropertyValue("--bld-near").trim(), css.getPropertyValue("--act").trim()];
    const hi = css.getPropertyValue("--hi").trim();
    const star = css.getPropertyValue("--star").trim();
    const bodyCells = BODY.flatMap((row, y) => [...row].flatMap((cell, x) => cell === "#" && x >= 3 ? [{ x: x - 10, y: y - 4 }] : []));
    const tailCells = BODY.flatMap((row, y) => [...row].flatMap((cell, x) => cell === "#" && x < 3 ? [{ x: x - 10, y: y - 4 }] : []));
    const fish = FISH.map((item) => ({ ...item, px: 0, py: 0 }));
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = 0;

    const draw = (time: number, dt: number) => {
      ctx.clearRect(0, 0, width, height);
      const fishScale = width < 680 ? .6 : 1;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = tones[0];
      ctx.globalAlpha = .14;
      for (let x = 32; x < width; x += 96) {
        for (let y = 32; y < height; y += 96) {
          ctx.fillRect(x - 3, y, 8, 2);
          ctx.fillRect(x, y - 3, 2, 8);
        }
      }

      for (const item of fish) {
        if (dt > 0) {
          item.px += item.vx * dt;
          item.py += item.vy * dt;
          if (item.vx > 0 && item.px > width + 150) item.px = -150;
          if (item.vx < 0 && item.px < -150) item.px = width + 150;
          if (item.py < 70 || item.py > height - 70) item.vy *= -1;
        }
        const direction = item.vx > 0 ? 1 : -1;
        const tailFrame = Math.floor(time * 5 + item.phase) % 2;
        ctx.globalAlpha = item.tone === 2 ? .46 : .3;
        ctx.fillStyle = tones[item.tone];
        ctx.font = "16px monospace";
        for (let i = 0; i < TRAIL_CHARS.length; i++) {
          const trailX = Math.round(item.px - direction * (58 + i * 22));
          const trailY = Math.round(item.py + (i % 2 ? 8 : -6));
          ctx.globalAlpha = .32 - i * .035;
          ctx.fillText(TRAIL_CHARS[(i + tailFrame) % TRAIL_CHARS.length], trailX, trailY);
        }

        ctx.save();
        ctx.translate(Math.round(item.px), Math.round(item.py));
        ctx.scale(direction * fishScale, fishScale);
        ctx.globalAlpha = (item.tone === 2 ? .68 : .55) * fishScale;
        for (const cell of bodyCells) ctx.fillRect(cell.x * item.pixel, cell.y * item.pixel, item.pixel, item.pixel);
        for (const cell of tailCells) ctx.fillRect(cell.x * item.pixel, (cell.y + tailFrame) * item.pixel, item.pixel, item.pixel);
        ctx.fillStyle = item.tone === 0 ? hi : star;
        ctx.globalAlpha = .42;
        ctx.fillRect(-2 * item.pixel, -2 * item.pixel, 2 * item.pixel, 2 * item.pixel);
        ctx.fillRect(item.pixel, item.pixel, 2 * item.pixel, 2 * item.pixel);
        ctx.globalAlpha = .9;
        ctx.fillStyle = hi;
        ctx.fillRect(4 * item.pixel, -item.pixel, item.pixel, item.pixel);
        ctx.fillStyle = star;
        ctx.globalAlpha = .28;
        ctx.fillRect(-2 * item.pixel, -3 * item.pixel, 3 * item.pixel, item.pixel);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      if (document.hidden) {
        last = now;
      } else if (now - last >= FRAME_MS) {
        const dt = Math.min((now - last) / 1000, .1);
        last = now;
        draw(now / 1000, dt);
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (motion.matches) draw(0, 0);
      else raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const item of fish) {
        item.px = item.x * width;
        item.py = item.y * height;
      }
      start();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener("change", start);
    resize();
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", start);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.ocean} aria-hidden="true" />;
}
