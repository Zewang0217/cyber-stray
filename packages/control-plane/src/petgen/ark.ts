/**
 * 火山方舟生图客户端（#128）：Seedream 5.0 Lite（同步 API）
 *
 * 替代原 DashScope qwen.ts（async 任务轮询已废弃）。视觉质检见 vision.ts
 * （OpenAI 兼容，智谱 GLM-4V-Flash；供应商可配）。全部 mock 友好：
 * 工厂注入 fetch，测试注入 fake 不打真实 API；真实密钥经
 * createImageGenerator(apiKey) 注入。
 *
 * API 形态（2026-08 官方文档确认）：
 * - 生图：POST {base}/images/generations（同步，无任务轮询、无下载）
 *   body: { model, prompt, image?, size, response_format: 'b64_json', watermark: false }
 *   resp: { data: [{ b64_json }], usage: { generated_images } }
 *   image 字段 = data URL（字符串或数组）；Seedream 5.0 无 1K 档，最小 2K。
 */

import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';
import type { ImageGenerator, ImageGenRequest } from './types.js';

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

export interface ArkImageOptions {
  /** 生图模型 ID；函数 = 每次 generate 求值（#131 热更新：装配时读配置缓存） */
  model: string | (() => string);
  /** 生图尺寸（Seedream 档位 '2K'/'3K' 或精确像素；5.0 无 1K 档） */
  size: string;
  /** 单次 HTTP 请求超时 ms（Seedream 5.0 建议 ≥120s——同步调用，断连结果即丢但仍计费） */
  requestTimeoutMs?: number;
  /** 注入式 fetch（测试 fake） */
  fetchFn?: typeof fetch;
}

/** 图片文件 → data URL（生图参考图输入；mime 按扩展名推断） */
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
      const model = typeof opts.model === 'function' ? opts.model() : opts.model;
      const body: Record<string, unknown> = {
        model,
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
