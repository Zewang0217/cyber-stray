/**
 * OpenAI 兼容视觉质检客户端（智谱 GLM-4V-Flash；baseUrl 可配，支持任意
 * OpenAI 兼容端点——质检供应商切换只改配置，不碰代码）
 *
 * 端点：POST {baseUrl}/chat/completions
 *   body: { model, messages: [{ role:'user', content: [{type:'text'|'image_url'}] }] }
 *   resp: { choices: [{ message: { content: string } }] }
 * 默认智谱开放平台（glm-4v-flash 免费；2026-08 实测可用）。
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import type { VisionQc, VisionQcRequest } from './types.js';
import { buildQcPrompt } from './prompt.js';

export const DEFAULT_VISION_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export interface VisionOptions {
  model: string;
  /** OpenAI 兼容端点根（不含 /chat/completions；默认智谱） */
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

/** 图片文件 → data URL（视觉质检输入；mime 按扩展名推断） */
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

/** 真实视觉质检服务工厂（概念图 + 状态帧双图输入） */
export function createVisionQc(apiKey: string, opts: VisionOptions): VisionQc {
  // key 检查推迟到调用时（与生图同理由：petgen 是可选功能，缺 key 不阻断 CP 启动）
  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_VISION_BASE_URL;

  return {
    async inspect(req: VisionQcRequest) {
      if (!apiKey) {
        throw new Error('缺少视觉质检 API key（环境变量 ZHIPU_API_KEY）');
      }
      const [refDataUrl, stateDataUrl] = await Promise.all([
        imageToDataUrl(req.referencePath),
        imageToDataUrl(req.statePath),
      ]);
      const res = await fetchFn(`${baseUrl}/chat/completions`, {
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
