/**
 * 火山方舟客户端（#128）：Seedream 5.0 Lite 生图（同步 API）+ 豆包视觉质检
 *
 * 替代原 DashScope qwen.ts（async 任务轮询已废弃）。全部 mock 友好：
 * 工厂注入 fetch，测试注入 fake 不打真实 API；真实密钥经
 * createImageGenerator/createVisionQc(apiKey) 注入。
 *
 * API 形态（2026-08 官方文档确认）：
 * - 生图：POST {base}/images/generations（同步，无任务轮询、无下载）
 *   body: { model, prompt, image?, size, response_format: 'b64_json', watermark: false }
 *   resp: { data: [{ b64_json }], usage: { generated_images } }
 *   image 字段 = data URL（字符串或数组）；Seedream 5.0 无 1K 档，最小 2K。
 * - 视觉：POST {base}/chat/completions（OpenAI 兼容）
 *   body: { model, messages: [{ role:'user', content: [{type:'text'|'image_url'}] }] }
 *   resp: { choices: [{ message: { content: string } }] }
 */

import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';
import type { ImageGenerator, ImageGenRequest, VisionQc, VisionQcRequest } from './types.js';
import { buildQcPrompt } from './prompt.js';

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

export interface ArkImageOptions {
  model: string;
  /** 生图尺寸（Seedream 档位 '2K'/'3K' 或精确像素；5.0 无 1K 档） */
  size: string;
  /** 单次 HTTP 请求超时 ms（Seedream 5.0 建议 ≥120s——同步调用，断连结果即丢但仍计费） */
  requestTimeoutMs?: number;
  /** 注入式 fetch（测试 fake） */
  fetchFn?: typeof fetch;
}

export interface ArkVisionOptions {
  model: string;
  fetchFn?: typeof fetch;
}

/** 图片文件 → data URL（生图参考图 / 视觉质检输入；mime 按扩展名推断） */
async function imageToDataUrl(path: string): Promise<string> {
  const buf = await readFile(path);
  const mime =
    extname(path).toLowerCase() === '.png'
      ? 'image/png'
      : extname(path).toLowerCase() === '.webp'
        ? 'image/webp'
        : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** 真实生图服务工厂 */
export function createImageGenerator(apiKey: string, opts: ArkImageOptions): ImageGenerator {
  // key 检查推迟到调用时（缺 key 时任务显式失败、控制面其他功能不受影响；
  // 不在构造时抛——petgen 是可选功能，不应阻断 CP 启动）
  const fetchFn = opts.fetchFn ?? fetch;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;

  return {
    async generate(req: ImageGenRequest) {
      if (!apiKey) {
        throw new Error('缺少火山方舟 API key（环境变量 ARK_API_KEY）');
      }
      const body: Record<string, unknown> = {
        model: opts.model,
        prompt: req.prompt,
        size: opts.size,
        response_format: 'b64_json',
        watermark: false,
      };
      if (req.reference) {
        body.image = await imageToDataUrl(req.reference);
      }
      const signal = AbortSignal.timeout(requestTimeoutMs);
      const res = await fetchFn(`${ARK_BASE}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        throw new Error(`生图失败: HTTP ${res.status} ${await res.text()}`);
      }
      const parsed = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const b64 = parsed.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error(`生图响应无 b64_json（禁兜底）: ${JSON.stringify(parsed).slice(0, 300)}`);
      }
      await writeFile(req.outPath, Buffer.from(b64, 'base64'));
      return { imagePath: req.outPath };
    },
  };
}

/** 解析视觉模型返回的 JSON（容忍 markdown 围栏）；解析失败抛错（禁兜底） */
export function parseQcJson(text: string): { pass: boolean; issues: string[] } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`质检输出非 JSON: ${text.slice(0, 200)}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { pass?: unknown }).pass !== 'boolean' ||
    !Array.isArray((parsed as { issues?: unknown }).issues)
  ) {
    throw new Error(`质检输出缺字段 pass/issues: ${cleaned.slice(0, 200)}`);
  }
  const issues = ((parsed as { issues: unknown[] }).issues).filter(
    (i): i is string => typeof i === 'string',
  );
  return { pass: (parsed as { pass: boolean }).pass, issues };
}

/** 真实视觉质检服务工厂（豆包视觉；概念图 + 状态帧双图输入） */
export function createVisionQc(apiKey: string, opts: ArkVisionOptions): VisionQc {
  // key 检查推迟到调用时（与 createImageGenerator 同理由）
  const fetchFn = opts.fetchFn ?? fetch;

  return {
    async inspect(req: VisionQcRequest) {
      if (!apiKey) {
        throw new Error('缺少火山方舟 API key（环境变量 ARK_API_KEY）');
      }
      const [refDataUrl, stateDataUrl] = await Promise.all([
        imageToDataUrl(req.referencePath),
        imageToDataUrl(req.statePath),
      ]);
      const res = await fetchFn(`${ARK_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: refDataUrl } },
                { type: 'image_url', image_url: { url: stateDataUrl } },
                { type: 'text', text: buildQcPrompt(req.state, req.spec) },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`质检调用失败: HTTP ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error(`质检响应无文本输出: ${JSON.stringify(body).slice(0, 300)}`);
      }
      return parseQcJson(text);
    },
  };
}
