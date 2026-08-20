/**
 * 表情包推送补发（#96）—— 复用 notifiable speak 机制送达
 *
 * 生成过质检的表情包 → 写一条 notifiable speak 记录（pushed=false，Web Push
 * 经 push-gateway 送达；URL 指向表情包图鉴页）。内容带图：text 含表情包文案，
 * url 指向 /meme（图鉴页，web 推送附链接——现有通道能力内：飞书/TG 文本、
 * Web Push URL；飞书/TG 原生图片附件需媒体上传，见 issue 范围注记）。
 *
 * 与 recordDiaryForPush 同构：复用 buildSpeakRecord 派生标题/摘要。
 */

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getDataPath } from '../config.js';
import { todaySpeaksFile } from '../tools/push/push-budget.js';
import type { MemeMeta } from './types.js';

/** 表情包图鉴页路径（Web Push url；相对路径由 PWA 解析） */
export const MEME_GALLERY_URL = '/meme';

/**
 * 写一条可通知的表情包记录（pushed=false，交给 push-gateway Web Push 送达）。
 * 失败显式抛错（禁兜底——推送补发是表情包交付的一部分）。
 */
export async function recordMemeForPush(meta: MemeMeta): Promise<{ title: string; file: string }> {
  const historyDir = getDataPath('history');
  await mkdir(historyDir, { recursive: true });
  const file = join(historyDir, todaySpeaksFile());
  const title = `表情包 · ${meta.emotion} · ${meta.topic}`;
  const record = {
    content: `给「${meta.topic}」做了张表情包：${meta.emotion}。图鉴见：/meme`,
    type: 'article',
    pushed: false,
    timestamp: new Date(meta.createdAt).toISOString(),
    title,
    url: MEME_GALLERY_URL,
    summary: `${meta.topic} · ${meta.emotion} · 图鉴 ${meta.file}`,
    gated: false,
    planLimited: false,
    meme: true,
  };
  await appendFile(file, JSON.stringify(record) + '\n', 'utf-8');
  return { title, file };
}
