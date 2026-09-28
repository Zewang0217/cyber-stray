/**
 * 视觉质检模型基准测试（一次性调试工具）：同一批图片 × 多个模型 × 图片尺寸变体，
 * 人工仲裁结果为 ground truth，回答「GLM-4V-Flash 的误杀是 prompt 问题还是模型问题」。
 *
 * 用例（人类判定为真值）：
 *   gt-idle / gt-walk / gt-sleep  内置猫官方帧条（手工雕的确定正确动画）→ 应全 PASS
 *   e2e-idle(-raw/-4x)            真机产物，人判合格 → 应 PASS
 *   e2e-walk(-raw/-4x)            真机产物，人判不合格（3/4 帧是坐猫）→ 应 FAIL
 *   e2e-sleep(-raw/-4x)           真机产物，人判合格 → 应 PASS
 *
 * 用法：cd packages/control-plane && bun run scripts/try-vision-bench.ts
 *   [--models glm-4.5v,ecnu-plus] [--base-url https://...] [--api-key-env CP_VISION_API_KEY]
 * 默认智谱端点 + ZHIPU_API_KEY；ECNU 例：
 *   bun run scripts/try-vision-bench.ts --models ecnu-plus \
 *     --base-url https://chat.ecnu.edu.cn/open/api/v1 --api-key-env CP_VISION_API_KEY
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAnimQcPrompt } from '../src/petgen/prompt.js';
import { parseQcJson } from '../src/petgen/vision.js';
import type { PetSpec } from '../src/petgen/types.js';

const ZHIPU = 'https://open.bigmodel.cn/api/paas/v4';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const baseUrl = argOf('--base-url') ?? ZHIPU;
const models = (argOf('--models') ?? 'glm-4v-flash,glm-4v-plus-0111,glm-4.5v').split(',');
const keyEnv = argOf('--api-key-env') ?? 'ZHIPU_API_KEY';
const thinking = process.argv.includes('--thinking');
const temperature = argOf('--temperature');
const apiKey = process.env[keyEnv];
if (!apiKey) throw new Error(`缺 ${keyEnv}`);

const dir = join(fileURLToPath(new URL('../../..', import.meta.url)), 'scratch', 'vision-bench');
const spec: PetSpec = {
  specText: '主人领养的宠物「小溜」,性格活泼,对AI、游戏感兴趣',
  stylePreset: 'pixel',
};

const MODELS = models;

interface Case {
  name: string;
  strip: string;
  anim: 'idle' | 'walk' | 'sleep';
  frames: number;
  /** 人类判定（真值） */
  human: 'pass' | 'fail';
}

const CASES: Case[] = [
  { name: 'gt-idle', strip: 'gt-idle.png', anim: 'idle', frames: 4, human: 'pass' },
  { name: 'gt-walk', strip: 'gt-walk.png', anim: 'walk', frames: 4, human: 'pass' },
  { name: 'gt-sleep', strip: 'gt-sleep.png', anim: 'sleep', frames: 2, human: 'pass' },
  { name: 'e2e-idle-raw', strip: 'e2e-idle-raw.png', anim: 'idle', frames: 4, human: 'pass' },
  { name: 'e2e-idle-4x', strip: 'e2e-idle-4x.png', anim: 'idle', frames: 4, human: 'pass' },
  { name: 'e2e-walk-raw', strip: 'e2e-walk-raw.png', anim: 'walk', frames: 4, human: 'fail' },
  { name: 'e2e-walk-4x', strip: 'e2e-walk-4x.png', anim: 'walk', frames: 4, human: 'fail' },
  { name: 'e2e-sleep-raw', strip: 'e2e-sleep-raw.png', anim: 'sleep', frames: 2, human: 'pass' },
];

function dataUrl(p: string): string {
  const b64 = readFileSync(p).toString('base64');
  return `data:image/${p.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${b64}`;
}

async function judge(model: string, c: Case): Promise<string> {
  const body = {
    model,
    ...(thinking ? { thinking: { type: 'enabled' }, reasoning_effort: 'medium' } : {}),
    ...(temperature !== undefined ? { temperature: Number(temperature) } : {}),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl(join(dir, 'reference.jpg')) } },
          { type: 'image_url', image_url: { url: dataUrl(join(dir, c.strip)) } },
          { type: 'text', text: buildAnimQcPrompt(c.anim, c.frames, spec) },
        ],
      },
    ],
  };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) return `HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`;
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content;
  if (!text) return '空响应';
  try {
    const qc = parseQcJson(text);
    return `${qc.pass ? 'PASS' : 'FAIL'}${qc.pass ? '' : '：' + (qc.issues[0] ?? '').slice(0, 40)}`;
  } catch (error) {
    return `解析失败(${(error as Error).message.slice(0, 30)})`;
  }
}

console.log('用例真值：gt-* 应 PASS；e2e-idle/sleep 应 PASS；e2e-walk 应 FAIL\n');
for (const model of MODELS) {
  console.log(`── ${model} ──`);
  let agree = 0;
  let total = 0;
  for (const c of CASES) {
    const verdict = await judge(model, c);
    const saidPass = verdict.startsWith('PASS');
    const ok = saidPass === (c.human === 'pass');
    if (ok) agree += 1;
    total += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${c.name.padEnd(14)} 人判=${c.human.padEnd(4)} 模型=${verdict}`);
  }
  console.log(`  与人判一致率：${agree}/${total}\n`);
}
