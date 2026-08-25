/**
 * OpenAI 兼容视觉质检客户端（表情包专用）—— 智谱 GLM-4V-Flash（免费）
 *
 * 与 petgen/vision.ts 同构：baseUrl 可配（供应商切换只改配置）；成品图 +
 * IP 参考图双图输入 → JSON 解析（容忍 markdown 围栏）。
 *
 * 端点：POST {baseUrl}/chat/completions（OpenAI 兼容 content 数组 + image_url）。
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import type { MemeCopy, MemeMode } from './types.js';

export const DEFAULT_VISION_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export interface VisionOptions {
  model: string;
  /** OpenAI 兼容端点根（不含 /chat/completions；默认智谱） */
  baseUrl?: string;
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

/** 语义质检 prompt（GLM-4V）：画面完整/无文字糊块/与情绪一致/IP 一致 */
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

/** 真实视觉质检服务工厂（成品图 + IP 参考图双图输入） */
export function createVisionQc(
  apiKey: string,
  opts: VisionOptions,
): (req: MemeVisionQcRequest) => Promise<{ pass: boolean; issues: string[] }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_VISION_BASE_URL;

  return async (req: MemeVisionQcRequest) => {
    if (!apiKey) {
      throw new Error('缺少视觉质检 API key（环境变量 ZHIPU_API_KEY）');
    }
    const content: Array<Record<string, unknown>> = [];
    if (req.referencePath) {
      content.push({ type: 'image_url', image_url: { url: await imageToDataUrl(req.referencePath) } });
    }
    content.push({ type: 'image_url', image_url: { url: await imageToDataUrl(req.imagePath) } });
    content.push({ type: 'text', text: buildMemeQcPrompt({ copy: req.copy, mode: req.mode }) });
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
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
