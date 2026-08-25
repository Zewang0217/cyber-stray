/**
 * 梦境生成器（#93）——睡前任务扩展：与日记同刻生成的抽象叙事
 *
 * 梦境是"活物感"功能：把当天兴趣/足迹当作意象原料做抽象联想重构
 * （openclaw 式），不是事实记录。与日记同素材（collectDiaryData）、
 * 同触发（睡前任务），但落盘独立文件 diary/dreams/YYYY-MM-DD.md
 * （ADR-0002 契约），夜间访问零延迟读取（预生成）。
 *
 * 素材范围：梦境只用当天**兴趣 + 足迹**（反馈不进梦境——梦是宠物对
 * 自己见闻的重构，不是社交总结）。两者皆空 = 当晚无梦（日记仍可能
 * 因反馈生成——梦与日记素材不完全同源）。
 *
 * 纯函数层（可测）：buildDreamPrompt（兴趣/足迹 + 性格 dreamStyle →
 * LLM prompt）、renderDreamMarkdown（叙述 → 落盘 markdown 结构）。
 * I/O 层：dreamFilePath / writeDreamMarkdown（走 getDataPath，租户隔离）。
 * LLM 层：generateDreamNarrative（AI SDK generateText，模型由调用方注入）。
 *
 * 风格：梦境风格来自性格注册表的 personality.dreamStyle（#90 已留字段，
 * 本期启用）——无用户可配选项（梦境不推送、不对外，属纯活物感）。
 */

import { generateText } from 'ai';
import { sanitizeForLLM } from '../../utils/text-sanitize.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { getDataRoot } from '../../config.js';
import { recordUsage, modelIdOf } from '../../usage/usage.js';
import { getDataPath } from '../../config.js';
import type { PersonalityProfile } from '@cyber-stray/shared';
import type { DiaryData } from './diary-generator.js';
import { writeFileAtomic } from './diary-generator.js';

/** 梦境落盘子目录（diary/dreams/，与日记同根、独立文件） */
export const DREAMS_DIR = 'dreams';

/** 梦境文件名：diary/dreams/YYYY-MM-DD.md（ADR-0002 契约） */
export function dreamFilePath(date: string): string {
  return getDataPath(join('diary', DREAMS_DIR, `${date}.md`));
}

/** 是否今晚有梦可做（梦境素材 = 兴趣 + 足迹；两者皆空 = 无梦） */
export function hasDreamContent(data: DiaryData): boolean {
  return data.footprint.length > 0 || data.interests.length > 0;
}

/**
 * 构建梦境生成 prompt（纯函数）。
 * 兴趣/足迹只作意象原料，prompt 显式要求抽象联想重构、禁止复述事实——
 * 输入关联由"原料段真实出现当天数据"保证（测试断言输入 → prompt 关联）。
 */
export function buildDreamPrompt(data: DiaryData, personality: PersonalityProfile): string {
  const sections: string[] = [
    `你是${data.petName}，一只${personality.name}性格的赛博宠物。今晚（${data.date}）你做了一个梦。`,
    `性格写照：${personality.description}`,
    `梦境风格：${personality.dreamStyle}`,
  ];

  const materials: string[] = [];
  if (data.interests.length > 0) {
    materials.push(
      `在意的兴趣：\n${data.interests.slice(0, 10).map((t) => `- ${t}`).join('\n')}`,
    );
  }
  if (data.footprint.length > 0) {
    const items = data.footprint
      .slice(0, 20)
      .map((s) => {
        const where = s.url ? `（看了 ${s.url}）` : '';
        const what = s.thought ? `：${s.thought.slice(0, 120)}` : '';
        return `- ${s.tool}${where}${what}`;
      })
      .join('\n');
    materials.push(`游荡的片段：\n${items}`);
  }

  sections.push(
    `梦的原料：\n${materials.join('\n\n')}`,
    '请写一段 150–300 字的第一人称梦境叙事。把我今天在意的兴趣和游荡的片段当作梦的意象原料，' +
      '做抽象联想重构：把它们打散、变形、组合成一个奇怪的梦。梦可以跳跃、矛盾、不合逻辑——' +
      '不要复述白天的真实经历，不要写"今天我搜了/我去了/我看了"这类事实记录。' +
      '用 markdown 输出（可带小标题），语气符合我的性格与梦境风格。',
  );

  return sections.join('\n\n');
}

/** 渲染最终落盘 markdown（纯函数）：标题 + 元信息头 + LLM 叙述 */
export function renderDreamMarkdown(
  narrative: string,
  meta: { date: string; petName: string; personalityName: string },
): string {
  const body = narrative.trim();
  return [
    `# 梦境 · ${meta.date}`,
    '',
    `**${meta.petName}** · 性格：${meta.personalityName} · 睡眠中的梦`,
    '',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** 落盘梦境 markdown（原子写：tmp + rename，复用日记同款实现） */
export async function writeDreamMarkdown(date: string, content: string): Promise<string> {
  const fullPath = dreamFilePath(date);
  await mkdir(getDataPath(join('diary', DREAMS_DIR)), { recursive: true });
  const tmp = `${fullPath}.tmp`;
  await writeFileAtomic(tmp, fullPath, content);
  return fullPath;
}

/** 生成梦境叙述（AI SDK generateText；模型由调用方注入，测试可 mock） */
export async function generateDreamNarrative(
  prompt: string,
  model: Parameters<typeof generateText>[0]['model'],
  temperature: number,
): Promise<string> {
  const result = await generateText({ model, temperature, prompt: sanitizeForLLM(prompt) });
  // #129：用量记录（no-throw）
  void recordUsage(getDataRoot(), {
    kind: 'llm',
    model: modelIdOf(model),
    tokens: result?.usage?.totalTokens,
  });
  return result.text;
}
