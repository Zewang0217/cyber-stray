/**
 * 火山方舟客户端（#128 表情包专用）—— Seedream 5.0 Lite 生图 + 豆包视觉质检
 *
 * 替代原 DashScope qwen.ts（async 任务轮询已废弃）。复用 #128 petgen/ark.ts
 * 的同步 API 模式（单请求出图 b64_json 落盘，无轮询无下载；参考图 data URL），
 * 但为表情包场景精简：单图、可选参考图（IP 模式用宠物概念图）、无网格。
 * 全部 mock 友好——工厂注入 fetch，测试注入 fake 不打真实 API；
 * 真实密钥经 createXxx(apiKey) 注入。
 *
 * API 形态（2026-08 官方文档确认，与 petgen/ark.ts 相同）：
 * - 生图：POST {base}/images/generations（同步）；参考图 data URL（image 字段）。
 * - 视觉：POST {base}/chat/completions（OpenAI 兼容 content 数组 + image_url）。
 */

import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';
import type { ImageGenerator, MemeCopy, MemeMode } from './types.js';

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

export interface ArkVisionOptions {
  model: string;
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

/** 视觉质检请求 */
export interface MemeVisionQcRequest {
  /** 待检成品图（已叠加文字） */
  imagePath: string;
  /** IP 模式参考图（宠物概念图；abstract 无参考） */
  referencePath?: string;
  copy: MemeCopy;
  mode: MemeMode;
}

/** 语义质检 prompt（豆包视觉）：画面完整/无文字糊块/与情绪一致/IP 一致 */
export function buildMemeQcPrompt(req: {
  copy: MemeCopy;
  mode: MemeMode;
}): string {
  const ipPart =
    req.mode === 'ip'
      ? '；3)角色是否与参考图明显不一致(物种/颜色/体型完全不同则 fail)'
      : '';
  return (
    `这张图应该是一张表情包，画面主题与话题"${req.copy.topic}"相关，情绪倾向"${req.copy.emotion}"。` +
    `画面上应叠加有清晰的梗文字"${req.copy.text}"。` +
    `请严格按以下 JSON 格式回答(只输出 JSON):{"pass": true/false, "issues": ["问题1", ...]}` +
    `。pass=false 当且仅当:1)画面残缺/畸形/模糊成一团;` +
    `2)梗文字不可读或被切掉一半(但画面内若有模型自己画的杂乱文字、水印、签名、乱码也算 fail)` +
    `${ipPart}。若全部符合则 pass=true,issues 为空数组。`
  );
}

/** 真实视觉质检服务工厂（豆包视觉；成品图 + IP 参考图双图输入） */
export function createVisionQc(
  apiKey: string,
  opts: ArkVisionOptions,
): (req: MemeVisionQcRequest) => Promise<{ pass: boolean; issues: string[] }> {
  const fetchFn = opts.fetchFn ?? fetch;

  return async (req: MemeVisionQcRequest) => {
    if (!apiKey) {
      throw new Error('缺少火山方舟 API key（环境变量 ARK_API_KEY）');
    }
    const content: Array<Record<string, unknown>> = [];
    if (req.referencePath) {
      content.push({ type: 'image_url', image_url: { url: await imageToDataUrl(req.referencePath) } });
    }
    content.push({ type: 'image_url', image_url: { url: await imageToDataUrl(req.imagePath) } });
    content.push({ type: 'text', text: buildMemeQcPrompt({ copy: req.copy, mode: req.mode }) });
    const res = await fetchFn(`${ARK_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`表情包质检调用失败: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error(`表情包质检响应无文本输出: ${JSON.stringify(body).slice(0, 300)}`);
    }
    return parseQcJson(text);
  };
}
