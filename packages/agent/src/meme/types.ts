/**
 * 表情包系统领域类型（#96）
 *
 * 图文分离硬契约（ADR-0001 + 调研结论）：生图模型只画画面，梗文字由
 * LLM 出文案（copy）+ 程序叠加（overlay，PIL/服务器端，中文清晰可读）。
 * 元数据（话题/情绪/日期）随生成写入，是图鉴检索基础。
 *
 * 依赖全部接口化——测试注入 fake，真实实现见 qwen.ts / overlay.ts / qc.ts。
 * 产物落租户数据目录 meme-assets/（manifest.json 索引 + meme-<id>.png）。
 */

import type { ImageGenRequest } from './qwen.js';

/** 表情包模式：abstract=通用风格抽象梗图 / ip=宠物概念图参考（IP 一致性） */
export type MemeMode = 'abstract' | 'ip';

/** LLM 出文案的产物（话题 → 梗文案 + 情绪） */
export interface MemeCopy {
  /** 梗文案（将程序叠加到画面上，用户可见） */
  text: string;
  /** 情绪标签（图鉴元数据） */
  emotion: string;
  /** 话题（图鉴元数据；通常 = 触发话题） */
  topic: string;
}

/** 表情包元数据（图鉴索引契约：话题/情绪/日期） */
export interface MemeMeta {
  id: string;
  topic: string;
  emotion: string;
  /** 生成日期（YYYY-MM-DD） */
  date: string;
  mode: MemeMode;
  /** 成品文件名（meme-assets/<file>） */
  file: string;
  /** 过质检才收录；false 表示被质检拦截（不进图鉴） */
  qcPass: boolean;
  createdAt: number;
}

/** 生图服务（qwen-image；测试注入 fake） */
export interface ImageGenerator {
  generate(req: ImageGenRequest): Promise<{ imagePath: string }>;
}

/** 文字叠加服务（PIL 服务器端；测试注入 fake） */
export interface Overlay {
  /** 把梗文案叠加到画面 → 输出成品图路径 */
  apply(imagePath: string, text: string, outPath: string): Promise<string>;
}

/** 质检服务（结构 + 语义；测试注入 fake） */
export interface MemeQc {
  /**
   * 校验成品图。pass=false → 不收录（不进图鉴）。
   * 结构：文件存在/有效；语义：无 AI 画字残留/无畸形/与话题情绪一致。
   */
  inspect(req: { imagePath: string; copy: MemeCopy; mode: MemeMode }): Promise<{
    pass: boolean;
    issues: string[];
  }>;
}

/** 表情包生成管线依赖（全注入，测试可全 fake） */
export interface MemePipelineDeps {
  /** 租户数据目录（meme-assets/ 落盘根） */
  dataDir: string;
  imageGen: ImageGenerator;
  overlay: Overlay;
  qc: MemeQc;
  /** 每日表情包上限（频率/成本控制；0 = 不限） */
  dailyLimit: number;
  /** 时钟（配额按天判定；测试注入） */
  now?: () => number;
}
