/**
 * 表情包生成管线（#96）—— 垂直切片编排
 *
 *   LLM 出文案（copy）→ 画面生图（abstract=通用风格 / ip=概念图参考）
 *   → 程序叠加文字（overlay，图文分离）→ 质检（结构+语义）
 *   → 过质检收录 manifest + 落盘成品图；不过则不收录。
 *
 * 触发点（两处）：日记写完（睡前任务尾部，generate-diary.ts）+ 推送后 agent
 * 自主调 tool（tools/registry/image-meme.ts）。依赖全部注入（copyGenerator、
 * imageGen/overlay/qc、dataDir、quota），测试可全 fake 走端到端。
 *
 * 配额/频率：生成前查当日剩余（dailyLimit）；超限 → 跳过（不消耗成本）。
 * 失败/质检不过不占配额（与 #94 同语义）。
 */

import { mkdir } from 'fs/promises';
import { join } from 'path';
import { localDateKey, memeQuotaRemaining } from './quota.js';
import { buildMemeImagePrompt } from './prompt.js';
import { appendManifest, buildMemeMeta, memeAssetsDir } from './storage.js';
import type { MemeCopy, MemeMeta, MemeMode, MemePipelineDeps } from './types.js';

/** 文案生成器（LLM；返回已解析的 MemeCopy，测试可 mock 注入固定值） */
export type MemeCopyGenerator = (input: { topic: string }) => Promise<MemeCopy>;

/** 管线执行入参 */
export interface MemePipelineInput {
  /** 触发话题（宠物游荡/日记兴趣） */
  topic: string;
  /** 抽象或 IP 模式（IP 需宠物概念图参考，由调用方决定可用性） */
  mode: MemeMode;
  /** 宠物概念图白底 JPEG 路径（IP 模式必填；abstract 忽略） */
  referencePath?: string;
  /** 宠物 spec 文本（IP 模式画面描述，可选） */
  petSpecText?: string;
}

/** 管线结果 */
export type MemePipelineResult =
  | { status: 'recorded'; meta: MemeMeta }
  | { status: 'rejected'; meta: MemeMeta; issues: string[] }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

/**
 * 执行一次表情包生成。步骤：
 * 1. 配额检查（超限 → skipped）
 * 2. 生成梗文案（copy，LLM）
 * 3. 画面生图（abstract / ip + 参考图）
 * 4. 程序叠加文字（overlay，图文分离）
 * 5. 质检（结构 + 语义）：不过 → rejected（不收录）
 * 6. 收录 manifest + 成品图
 */
export async function runMemePipeline(
  deps: MemePipelineDeps,
  input: MemePipelineInput,
  copyGenerator: MemeCopyGenerator,
): Promise<MemePipelineResult> {
  const now = deps.now?.() ?? Date.now();
  const date = localDateKey(new Date(now));

  // 1. 配额（失败/质检不过不占配额，先查——超限直接跳过）
  const remaining = await memeQuotaRemaining(deps.dataDir, deps.dailyLimit, date);
  if (remaining <= 0) {
    return { status: 'skipped', reason: `今日表情包配额已用完（${deps.dailyLimit} 张/天）` };
  }

  let copy: MemeCopy;
  try {
    copy = await copyGenerator({ topic: input.topic });
  } catch (error) {
    return {
      status: 'failed',
      error: `表情包文案生成失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // 先派发元数据（id/文件名），让整条链路的路径都从 meta 派生（一致、可追踪）
  const meta = buildMemeMeta({
    topic: copy.topic || input.topic,
    emotion: copy.emotion,
    date,
    mode: input.mode,
    qcPass: false, // 质检后才定收录；rejected 时置 false 已是最终态
    now,
  });
  const rawPath = join(memeAssetsDir(deps.dataDir), `raw-${meta.id}.png`);
  const finalPath = join(memeAssetsDir(deps.dataDir), meta.file);

  // 3. 画面生图（图文分离：画面 prompt 绝不含梗文字）
  // 生图前确保目录存在（#133 产机暴露：mkdir 原在收录步，writeFile rawPath ENOENT）
  try {
    await mkdir(memeAssetsDir(deps.dataDir), { recursive: true });
  } catch (error) {
    return {
      status: 'failed',
      error: `表情包目录创建失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const prompt = buildMemeImagePrompt(copy, input.mode, input.petSpecText);
  try {
    await deps.imageGen.generate({
      prompt,
      outPath: rawPath,
      ...(input.mode === 'ip' && input.referencePath
        ? { reference: input.referencePath }
        : {}),
    });
  } catch (error) {
    return {
      status: 'failed',
      error: `表情包生图失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // 4. 程序叠加文字（图文分离核心：梗文字经 PIL 叠加，模型不画字）
  try {
    await deps.overlay.apply(rawPath, copy.text, finalPath);
  } catch (error) {
    return {
      status: 'failed',
      error: `表情包文字叠加失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // 5. 质检：不过 → 不收录（qcPass 保持 false）
  const qc = await deps.qc.inspect({ imagePath: finalPath, copy, mode: input.mode });
  if (!qc.pass) {
    return { status: 'rejected', meta, issues: qc.issues };
  }

  // 6. 收录（manifest 记录 qcPass=true，图已落盘）
  try {
    await appendManifest(deps.dataDir, { ...meta, qcPass: true });
  } catch (error) {
    return {
      status: 'failed',
      error: `表情包收录失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { status: 'recorded', meta: { ...meta, qcPass: true } };
}
