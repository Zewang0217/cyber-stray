/**
 * 表情包生图 prompt 构建器（#96）—— 图文分离硬契约
 *
 * 确定性模板（不引入 LLM）：abstract=通用风格抽象梗图 / ip=宠物概念图参考。
 * 画面 prompt 绝不让模型画文字/梗（ADR-0001）——梗文字由 overlay 程序叠加。
 * 通用禁止项：不要文字/水印/签名（防模型画字与杂物）。
 */

import type { MemeCopy, MemeMode } from './types.js';

/** 通用禁止项（图文分离 + 防水印） */
const NEGATIVES = '不要任何文字,不要字母,不要水印,不要签名,不要边框,不要logo';

/** 抽象模式：无角色参考图，但仍使用同次文案生成的具体画面。 */
const ABSTRACT_SCENE =
  '一张适合做表情包的抽象梗图,高对比度,主体清晰,风格干净利落';

/** 文案 → 情绪氛围片段（prompt 里的情绪基调） */
function emotionFragment(emotion: string): string {
  const mood: Record<string, string> = {
    开心: '欢快明亮,暖色调,元气满满',
    自嘲: '略带自嘲的无奈感,柔和色调,有一点丧',
    吐槽: '搞怪夸张,戏谑感,对比强烈',
    燃: '热血激昂,高饱和,动态张力',
    丧: '低饱和灰调,慵懒,一种淡淡的无力感',
  };
  return mood[emotion] ?? `情绪氛围:${emotion}`;
}

/**
 * 画面 prompt：
 * - abstract：具体无字场景 + 情绪基调
 * - ip：宠物角色（specText）+ 具体无字场景 + 概念图参考锁角色
 */
export function buildMemeImagePrompt(
  copy: MemeCopy,
  mode: MemeMode,
  petSpecText?: string,
): string {
  if (copy.scene.includes(copy.text)) {
    throw new Error('表情包画面场景不能包含叠字文案原文');
  }
  const base =
    mode === 'ip'
      ? `以传入的宠物参考图为唯一角色形象依据${petSpecText ? `（角色描述：${petSpecText}）` : ''},` +
        `保持参考图中的物种、毛色、花纹和配饰,角色完整清晰`
      : ABSTRACT_SCENE;
  return `${base}。具体画面：${copy.scene}。${emotionFragment(copy.emotion)}。` +
    `画面下方留出干净的纯色区域供后续程序叠字,画面本身不画字。${NEGATIVES}。`;
}
