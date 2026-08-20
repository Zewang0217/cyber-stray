/**
 * DashScope 客户端（#96 表情包专用）—— qwen-image 生图 + qwen-vl 视觉质检
 *
 * 复用 #94 petgen/qwen.ts 的模式（async 任务 API + 轮询 + 下载落盘；参考图
 * base64 锁角色；qwen-vl 双图输入 + JSON 解析），但为表情包场景精简：单图、
 * 可选参考图（IP 模式用宠物概念图）、无网格。全部 mock 友好——工厂注入
 * fetch/sleep，测试注入 fake 不打真实 API；真实密钥经 createXxx(apiKey) 注入。
 *
 * API 形态（spike §1.1 实测结论，与 #94 相同）：
 * - 生图：POST /services/aigc/text2image/image-synthesis，必须带
 *   X-DashScope-Async: enable；轮询 GET /tasks/{task_id} 至 SUCCEEDED。
 * - 参考图：input.image = base64（≤61440 字符）。
 * - 视觉：POST /services/aigc/multimodal-generation/generation（同步）。
 */

import { readFile, writeFile } from 'fs/promises';
import type { ImageGenerator, MemeCopy, MemeMode } from './types.js';

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';

/** DashScope 参考图 base64 上限（API 文档硬限制，与 #94 同） */
export const REFERENCE_BASE64_LIMIT = 61_440;

/** 生图请求 */
export interface ImageGenRequest {
  prompt: string;
  /** 输出路径（管线落盘用） */
  outPath: string;
  /** 参考图（IP 模式 = 宠物概念图白底 JPEG；abstract 缺省） */
  reference?: string;
}

export interface QwenImageOptions {
  model: string;
  size: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface QwenVisionOptions {
  model: string;
  fetchFn?: typeof fetch;
}

interface TaskBody {
  output?: {
    task_id?: string;
    task_status?: string;
    message?: string;
    results?: Array<{ url?: string }>;
  };
}

interface VisionBody {
  output?: {
    choices?: Array<{ message?: { content?: Array<{ text?: string }> } }>;
  };
}

/** 带超时的 fetch（AbortSignal.timeout——防网络挂起拖死生成） */
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
      body: JSON.stringify({ model, input, parameters: { size, n: 1 } }),
    },
    timeoutMs,
  );
  if (!res.ok) {
    throw new Error(`表情包生图任务提交失败: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as TaskBody;
  const taskId = body.output?.task_id;
  if (!taskId) {
    throw new Error(`表情包生图任务提交无 task_id: ${JSON.stringify(body)}`);
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
      throw new Error(`表情包生图任务轮询失败: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as TaskBody;
    const status = body.output?.task_status;
    if (status === 'SUCCEEDED') {
      const urls = (body.output?.results ?? []).map((r) => r.url).filter((u): u is string => !!u);
      if (urls.length === 0) {
        throw new Error('表情包生图 SUCCEEDED 但无结果 URL（禁兜底）');
      }
      return urls;
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`表情包生图任务${status}: ${body.output?.message ?? '未知原因'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`表情包生图任务超时（${opts.pollTimeoutMs}ms）`);
    }
    await opts.sleep(opts.pollIntervalMs);
  }
}

/** 图片文件 → base64（参考图输入） */
async function imageToBase64(path: string): Promise<string> {
  const buf = await readFile(path);
  return buf.toString('base64');
}

/** 真实生图服务工厂（fetch/sleep 可注入；key 检查推迟到调用时，缺 key 显式失败） */
export function createImageGenerator(apiKey: string, opts: QwenImageOptions): ImageGenerator {
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
            `参考图 base64 ${b64.length} 字符超过 DashScope 上限 ${REFERENCE_BASE64_LIMIT}`,
          );
        }
        input.image = b64;
      }
      const taskId = await submitTask(
        fetchFn,
        apiKey,
        opts.model,
        opts.size,
        input,
        requestTimeoutMs,
      );
      const urls = await pollTask(fetchFn, apiKey, taskId, {
        pollIntervalMs,
        pollTimeoutMs,
        requestTimeoutMs,
        sleep,
      });
      const url = urls[0];
      if (!url) {
        throw new Error('表情包生图结果 URL 缺失（禁兜底）');
      }
      const res = await fetchWithTimeout(fetchFn, url, {}, requestTimeoutMs);
      if (!res.ok) {
        throw new Error(`表情包生图结果下载失败: HTTP ${res.status}`);
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

/** 视觉质检请求 */
export interface MemeVisionQcRequest {
  /** 待检成品图（已叠加文字） */
  imagePath: string;
  /** IP 模式参考图（宠物概念图；abstract 无参考） */
  referencePath?: string;
  copy: MemeCopy;
  mode: MemeMode;
}

/** 语义质检 prompt（qwen-vl）：画面完整/无文字糊块/与情绪一致/IP 一致 */
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

/** 真实视觉质检服务工厂（qwen-vl；成品图 + IP 参考图双图输入） */
export function createVisionQc(
  apiKey: string,
  opts: QwenVisionOptions,
): (req: MemeVisionQcRequest) => Promise<{ pass: boolean; issues: string[] }> {
  const fetchFn = opts.fetchFn ?? fetch;

  return async (req: MemeVisionQcRequest) => {
    if (!apiKey) {
      throw new Error('缺少 DashScope API key（环境变量 DASHSCOPE_API_KEY）');
    }
    const content: Array<Record<string, string>> = [];
    if (req.referencePath) {
      content.push({ image: `data:image/jpeg;base64,${await imageToBase64(req.referencePath)}` });
    }
    content.push({ image: `data:image/png;base64,${await imageToBase64(req.imagePath)}` });
    content.push({ text: buildMemeQcPrompt({ copy: req.copy, mode: req.mode }) });
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
          input: { messages: [{ role: 'user', content }] },
          parameters: { result_format: 'message' },
        }),
      },
      60_000,
    );
    if (!res.ok) {
      throw new Error(`表情包质检调用失败: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as VisionBody;
    const text = body.output?.choices?.[0]?.message?.content?.[0]?.text;
    if (!text) {
      throw new Error(`表情包质检响应无文本输出: ${JSON.stringify(body).slice(0, 300)}`);
    }
    return parseQcJson(text);
  };
}
