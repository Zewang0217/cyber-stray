/**
 * 表情包文案生成执行（#96）—— 组装 prompt + LLM 调用 + Zod 校验
 *
 * 供 image-meme 工具与睡前任务共用的高层封装：给定话题/宠物信息，返回
 * 已校验的 MemeCopy。模型由调用方注入（工具用 getConfig 建 DeepSeek，
 * 睡前任务用传入的 model——见 generate-diary.ts）。
 */

import { buildMemeCopyPrompt, generateMemeCopy, parseMemeCopy } from './copy.js';
import type { MemeCopyGenerator } from './pipeline.js';
import type { MemeCopy } from './types.js';

/** 构建一个文案生成器（prompt 组装 + LLM + 校验全封装；模型注入，测试可 mock） */
export function createMemeCopyRunner(input: {
  petName: string;
  personalityName?: string;
  model: Parameters<typeof generateMemeCopy>[1];
}): MemeCopyGenerator {
  return async ({ topic }: { topic: string }): Promise<MemeCopy> => {
    const prompt = buildMemeCopyPrompt({
      topic,
      petName: input.petName,
      personalityName: input.personalityName,
    });
    const raw = await generateMemeCopy(prompt, input.model);
    return parseMemeCopy(raw, topic);
  };
}
