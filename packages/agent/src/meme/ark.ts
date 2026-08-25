/**
 * 火山方舟生图客户端（#128 表情包专用）—— Seedream 5.0 Lite
 *
 * 替代原 DashScope qwen.ts（async 任务轮询已废弃）。视觉质检见 vision.ts
 * （OpenAI 兼容，智谱 GLM-4V-Flash；供应商可配）。复用 #128 petgen/ark.ts
 * 的同步 API 模式（单请求出图 b64_json 落盘，无轮询无下载；参考图 data URL），
 * 为表情包场景精简：单图、可选参考图（IP 模式用宠物概念图）、无网格。
 * 全部 mock 友好——工厂注入 fetch，测试注入 fake 不打真实 API。
 *
 * API 形态（2026-08 官方文档确认，与 petgen/ark.ts 相同）：
 * - 生图：POST {base}/images/generations（同步）；参考图 data URL（image 字段）。
 */

import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';
import type { ImageGenerator } from './types.js';

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

/** 生图请求 */
export interface ImageGenRequest {
  prompt: string;
  /** 输出路径（管线落盘用） */
  outPath: string;
  /** 参考图（IP 模式 = 宠物概念图；abstract 缺省） */
  reference?: string;
}

export interface ArkImageOptions {
  model: string;
  size: string;
  /** 单次 HTTP 请求超时 ms（Seedream 5.0 建议 ≥120s） */
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** 图片文件 → data URL（mime 按扩展名推断） */
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

/** 真实生图服务工厂（fetch 可注入；key 检查推迟到调用时，缺 key 显式失败） */
export function createImageGenerator(apiKey: string, opts: ArkImageOptions): ImageGenerator {
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
      const res = await fetchFn(`${ARK_BASE}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`表情包生图失败: HTTP ${res.status} ${await res.text()}`);
      }
      const parsed = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = parsed.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error(`表情包生图响应无 b64_json（禁兜底）: ${JSON.stringify(parsed).slice(0, 300)}`);
      }
      await writeFile(req.outPath, Buffer.from(b64, 'base64'));
      return { imagePath: req.outPath };
    },
  };
}
