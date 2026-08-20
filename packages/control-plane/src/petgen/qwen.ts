/**
 * DashScope 客户端（#94）：qwen-image 生图（async 任务 API）+ qwen-vl 视觉质检
 *
 * 全部 mock 友好：工厂注入 fetch/sleep，测试注入 fake 不打真实 API；
 * 真实密钥经 createImageGenerator/createVisionQc(apiKey) 注入。
 *
 * API 形态（spike §1.1 实测结论）：
 * - 生图：POST /services/aigc/text2image/image-synthesis，必须带
 *   X-DashScope-Async: enable（本账号不支持同步，同步直接 AccessDenied）；
 *   轮询 GET /tasks/{task_id} 至 SUCCEEDED 取 results[0].url 下载。
 * - 参考图：input.image = base64（≤61440 字符，256px PNG 超限 → 白底 JPEG）。
 * - 视觉：POST /services/aigc/multimodal-generation/generation（同步）。
 */

import { readFile, writeFile } from 'fs/promises';
import type { ImageGenerator, ImageGenRequest, VisionQc, VisionQcRequest } from './types.js';
import { buildQcPrompt } from './prompt.js';

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';

/** DashScope 参考图 base64 上限（API 文档硬限制） */
export const REFERENCE_BASE64_LIMIT = 61_440;

export interface QwenImageOptions {
  model: string;
  /** 生图尺寸（DashScope size 参数，如 1024*1024） */
  size: string;
  /** async 任务轮询间隔 ms */
  pollIntervalMs?: number;
  /** async 任务超时 ms */
  pollTimeoutMs?: number;
  /** 单次 HTTP 请求超时 ms（提交/轮询/下载；防网络挂起拖死队列） */
  requestTimeoutMs?: number;
  /** 注入式 fetch（测试 fake） */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface QwenVisionOptions {
  model: string;
  fetchFn?: typeof fetch;
}

/** 带超时的 fetch（AbortSignal.timeout——防网络挂起拖死生成队列） */
function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  const existing = init.signal;
  return fetchFn(url, {
    ...init,
    signal: existing ? AbortSignal.any([existing, signal]) : signal,
  });
}

/** 提交生图任务 → { taskId } */
async function submitTask(
  fetchFn: typeof fetch,
  apiKey: string,
  model: string,
  size: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const res = await fetchWithTimeout(
    fetchFn,
    `${DASHSCOPE_BASE}/services/aigc/text2image/image-synthesis`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model,
        input,
        parameters: { size, n: 1 },
      }),
    },
    timeoutMs,
  );
  if (!res.ok) {
    throw new Error(`生图任务提交失败: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { output?: { task_id?: string; task_status?: string; message?: string } };
  const taskId = body.output?.task_id;
  if (!taskId) {
    throw new Error(`生图任务提交无 task_id: ${JSON.stringify(body)}`);
  }
  return taskId;
}

/** 轮询生图任务 → 结果图 URL 列表 */
async function pollTask(
  fetchFn: typeof fetch,
  apiKey: string,
  taskId: string,
  opts: {
    pollIntervalMs: number;
    pollTimeoutMs: number;
    requestTimeoutMs: number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<string[]> {
  const deadline = Date.now() + opts.pollTimeoutMs;
  for (;;) {
    const res = await fetchWithTimeout(
      fetchFn,
      `${DASHSCOPE_BASE}/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      opts.requestTimeoutMs,
    );
    if (!res.ok) {
      throw new Error(`生图任务轮询失败: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      output?: { task_status?: string; results?: Array<{ url?: string }>; message?: string };
    };
    const status = body.output?.task_status;
    if (status === 'SUCCEEDED') {
      const urls = (body.output?.results ?? []).map((r) => r.url).filter((u): u is string => !!u);
      if (urls.length === 0) {
        throw new Error('生图任务 SUCCEEDED 但无结果 URL（禁兜底，显式失败）');
      }
      return urls;
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`生图任务${status}: ${body.output?.message ?? '未知原因'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`生图任务超时（${opts.pollTimeoutMs}ms）`);
    }
    await opts.sleep(opts.pollIntervalMs);
  }
}

/** 图片文件 → base64（生图参考图输入） */
async function imageToBase64(path: string): Promise<string> {
  const buf = await readFile(path);
  return buf.toString('base64');
}

/** 真实生图服务工厂 */
export function createImageGenerator(apiKey: string, opts: QwenImageOptions): ImageGenerator {
  // key 检查推迟到调用时（缺 key 时任务显式失败、控制面其他功能不受影响；
  // 不在构造时抛——petgen 是可选功能，不应阻断 CP 启动）
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep =
    opts.sleep ??
    ((ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    });
  const pollIntervalMs = opts.pollIntervalMs ?? 3_000;
  const pollTimeoutMs = opts.pollTimeoutMs ?? 180_000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;

  return {
    async generate(req: ImageGenRequest) {
      if (!apiKey) {
        throw new Error('缺少 DashScope API key（环境变量 DASHSCOPE_API_KEY）');
      }
      const input: Record<string, unknown> = { prompt: req.prompt };
      if (req.reference) {
        const b64 = await imageToBase64(req.reference);
        if (b64.length > REFERENCE_BASE64_LIMIT) {
          throw new Error(
            `参考图 base64 ${b64.length} 字符超过 DashScope 上限 ${REFERENCE_BASE64_LIMIT}` +
              '（调小 CP_PETGEN_REFERENCE_FRAME 重试）',
          );
        }
        input.image = b64;
      }
      const taskId = await submitTask(fetchFn, apiKey, opts.model, opts.size, input, requestTimeoutMs);
      const urls = await pollTask(fetchFn, apiKey, taskId, {
        pollIntervalMs,
        pollTimeoutMs,
        requestTimeoutMs,
        sleep,
      });
      const url = urls[0];
      if (!url) {
        throw new Error('生图结果 URL 缺失（禁兜底）');
      }
      const res = await fetchWithTimeout(fetchFn, url, {}, requestTimeoutMs);
      if (!res.ok) {
        throw new Error(`生图结果下载失败: HTTP ${res.status}`);
      }
      await writeFile(req.outPath, Buffer.from(await res.arrayBuffer()));
      return { imagePath: req.outPath };
    },
  };
}

/** 解析 qwen-vl 返回的 JSON（容忍 markdown 围栏）；解析失败抛错（禁兜底） */
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

/** 真实视觉质检服务工厂（qwen-vl；概念图 + 状态帧双图输入） */
export function createVisionQc(apiKey: string, opts: QwenVisionOptions): VisionQc {
  // key 检查推迟到调用时（与 createImageGenerator 同理由）
  const fetchFn = opts.fetchFn ?? fetch;

  return {
    async inspect(req: VisionQcRequest) {
      if (!apiKey) {
        throw new Error('缺少 DashScope API key（环境变量 DASHSCOPE_API_KEY）');
      }
      const [refB64, stateB64] = await Promise.all([
        imageToBase64(req.referencePath),
        imageToBase64(req.statePath),
      ]);
      const res = await fetchWithTimeout(
        fetchFn,
        `${DASHSCOPE_BASE}/services/aigc/multimodal-generation/generation`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: opts.model,
            input: {
              messages: [
                {
                  role: 'user',
                  content: [
                    { image: `data:image/png;base64,${refB64}` },
                    { image: `data:image/png;base64,${stateB64}` },
                    { text: buildQcPrompt(req.state, req.spec) },
                  ],
                },
              ],
            },
            parameters: { result_format: 'message' },
          }),
        },
        60_000,
      );
      if (!res.ok) {
        throw new Error(`质检调用失败: HTTP ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        output?: { choices?: Array<{ message?: { content?: Array<{ text?: string }> } }> };
      };
      const text = body.output?.choices?.[0]?.message?.content?.[0]?.text;
      if (!text) {
        throw new Error(`质检响应无文本输出: ${JSON.stringify(body).slice(0, 300)}`);
      }
      return parseQcJson(text);
    },
  };
}
