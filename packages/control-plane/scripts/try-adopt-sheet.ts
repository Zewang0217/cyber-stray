/**
 * 领养精灵图 4×4 出图验证（一次性调试工具，不进管线、不入库）
 *
 * 复用真实管线代码（prompt.ts / ark.ts / splitter.ts / shared 注册表），
 * 打一次 Seedream 真实 API：出 4×4 全动作全帧精灵图 → 确定性切分 →
 * 产出 preview.html（纯 CSS steps() 播放 6 个动画）供人工验收。
 *
 * 用法：
 *   cd packages/control-plane && bun run scripts/try-adopt-sheet.ts [specText]
 * 环境变量：ARK_API_KEY（必填）、CP_ARK_IMAGE_MODEL（可选，默认 Seedream 5.0 Lite）
 * 产物落仓库根 scratch/adopt-sheet/。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PET_PRESET,
  PET_SHEET_ANIMS,
  PET_SHEET_FRAME,
  PET_SHEET_GRID,
  PET_STYLE_PRESETS,
} from '@cyber-stray/shared/pet';
import { buildSheetPrompt, sheetRowOf } from '../src/petgen/prompt.js';
import { createImageGenerator } from '../src/petgen/ark.js';
import { createSplitter } from '../src/petgen/splitter.js';
import type { PetSpec } from '../src/petgen/types.js';

const apiKey = process.env.ARK_API_KEY;
if (!apiKey) throw new Error('缺 ARK_API_KEY（packages/control-plane/.env）');

const specText =
  process.argv[2] ??
  '主人领养的宠物「小橘」,一只圆脸橘色小猫,性格活泼,对小鱼干和逗猫棒特别感兴趣';
const spec: PetSpec = { specText, stylePreset: DEFAULT_PET_PRESET };
const preset = PET_STYLE_PRESETS.pixel; // 领养路径锁定像素风

const outDir = join(fileURLToPath(new URL('../../..', import.meta.url)), 'scratch', 'adopt-sheet');
await mkdir(outDir, { recursive: true });

// 1. 出图（与 processor.runSheetStrategy 同参：2K、参考图留空测纯 spec 路径）
const prompt = buildSheetPrompt(spec, preset, PET_SHEET_ANIMS, PET_SHEET_GRID);
console.log('[1/3] 生图 prompt：\n' + prompt + '\n');
const rawPath = join(outDir, 'sheet-raw.png');
await createImageGenerator(apiKey, {
  model: process.env.CP_ARK_IMAGE_MODEL ?? 'doubao-seedream-5-0-260128',
  size: '2K',
}).generate({ kind: 'sheet', prompt, outPath: rawPath });
console.log('[2/3] 出图完成 →', rawPath);

// 2. 切分（与管线同一脚本封装）
const result = await createSplitter().splitSheet(rawPath, {
  rows: PET_SHEET_GRID,
  cols: PET_SHEET_GRID,
  anims: PET_SHEET_ANIMS,
  frame: PET_SHEET_FRAME,
  outDir,
});
console.log('[3/3] 切分完成：', JSON.stringify({ emptyCells: result.emptyCells, frames: result.frames }, null, 2));
for (const [anim, ratios] of Object.entries(result.ratios)) {
  console.log(`  ${anim}: ${(ratios.map((r) => (r * 100).toFixed(0) + '%')).join(' ')}`);
}
if (result.emptyCells > 0) {
  console.warn(`⚠ 漏格 ${result.emptyCells} 格——真实管线会在此重试/降级 strip`);
}

// 3. 预览页：与 web PetSprite 同款纯 CSS steps() 播放
const durations = Object.fromEntries(PET_SHEET_ANIMS.map((a) => [a.state, a.duration]));
const froms: Record<string, number> = {};
let cursor = 0;
for (const a of PET_SHEET_ANIMS) {
  froms[a.state] = cursor;
  cursor += a.frames;
}
const total = cursor;
const animBlocks = PET_SHEET_ANIMS.map((a) => {
  const to = -(froms[a.state] + a.frames);
  const kf = `@keyframes sb-${a.state}{from{background-position:calc(var(--step) * ${-froms[a.state]}) 0}to{background-position:calc(var(--step) * ${to}) 0}}`;
  const style = `animation:sb-${a.state} ${a.duration}s steps(${a.frames}) infinite`;
  return `${kf}
.anim-cell .sheet-${a.state}{${style}}`;
}).join('\n');

const cells = PET_SHEET_ANIMS.map(
  (a) => `<figure><div class="anim-cell"><div class="sprite sheet-${a.state}"></div></div><figcaption>${a.state}（${a.frames} 帧 / ${durations[a.state]}s）</figcaption></figure>`,
).join('\n');

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>领养精灵图预览（4×4 出图验证）</title>
<style>
  body{background:#141420;color:#eee;font-family:system-ui,sans-serif;padding:24px}
  h1{font-size:18px} p{color:#999;font-size:13px}
  .raw img{max-width:640px;image-rendering:pixelated;border:1px solid #333}
  .grid{display:flex;flex-wrap:wrap;gap:18px;margin-top:16px}
  figure{margin:0;text-align:center}
  figcaption{font-size:12px;color:#888;margin-top:6px}
  .anim-cell{width:192px;height:192px;background:#1d1d2b;border:1px solid #333;
    display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
  .sprite{--step:192px;width:192px;height:192px;background-repeat:no-repeat;
    background-image:url(sprite.png);background-size:${total * 192}px 192px;
    image-rendering:pixelated;align-self:center}
  .spec{color:#aaa;font-size:13px}
</style>
<script>/* reduced-motion 用户：动画停帧也可见首帧，无需 JS */</script>
</head><body>
<h1>领养精灵图 4×4 出图验证</h1>
<p class="spec">spec：${specText}（风格：pixel｜模型：${process.env.CP_ARK_IMAGE_MODEL ?? 'doubao-seedream-5-0-260128'}｜漏格：${result.emptyCells}）</p>
<h2 style="font-size:15px">动画预览（64px 帧 ×3 播放）</h2>
<div class="grid">
${cells}
</div>
<style>
${animBlocks}
</style>
<h2 style="font-size:15px">原始出图（2K 网格）</h2>
<div class="raw"><img src="sheet-raw.png" alt="raw sheet"></div>
<h2 style="font-size:15px">切分总条 sprite.png（${total * 64}×64）</h2>
<div class="raw"><img src="sprite.png" style="image-rendering:pixelated" alt="sprite strip"></div>
</body></html>`;
await writeFile(join(outDir, 'preview.html'), html);
console.log('\n预览页 →', join(outDir, 'preview.html'));
