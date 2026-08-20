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

/** 抽象模式：通用风格梗图画面（情绪氛围 + 留白构图，文字叠加区留空） */
const ABSTRACT_SCENE =
  '一张适合做表情包的抽象梗图,简洁大气的视觉构图,主体居中,' +
  '画面底部留出干净的纯色/渐变色条带区域(供叠加文字),情绪氛围鲜明,' +
  '高对比度,风格干净利落,适合年轻用户斗图';

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
 * - abstract：通用风格场景（emotion 基调）
 * - ip：宠物角色（specText）+ 概念图参考锁角色（reference 由 pipeline 传）
 */
export function buildMemeImagePrompt(
  copy: MemeCopy,
  mode: MemeMode,
  petSpecText?: string,
): string {
  const base =
    mode === 'ip'
      ? `宠物角色(${petSpecText ?? '我的赛博宠物'})做出一个与情绪"${copy.emotion}"相符的表情动作,` +
        `全身/半身均可,角色完整清晰,保持与参考图一致的形象`
      : ABSTRACT_SCENE;
  return `${base}。${emotionFragment(copy.emotion)}。${NEGATIVES}。`;
}
