/**
 * 表情包质检（#96）—— 复用 #94 结构/语义两层质检模式
 *
 * 两层：
 * - 结构层：成品文件存在且非空（脚本层已在 overlay 抛错，这里做最终落盘
 *   检查——禁兜底：文件缺失/空 → 判 fail 不进图鉴）。
 * - 语义层：视觉模型检查画面完整 / 文字可读无 AI 画字残留 / 与话题情绪一致
 *   / IP 模式角色一致（buildMemeQcPrompt，见 vision.ts）。
 *
 * 质检不过 → 不收录（qcPass=false，图鉴 API 只展示 pass 的）。依赖全部
 * 注入（structure 检查 fs、semantic 检查由 createVisionQc 注入），可 mock。
 */

import { access, stat } from 'fs/promises';
import type { MemeCopy, MemeMode, MemeQc } from './types.js';
import type { MemeVisionQcRequest } from './vision.js';

/** 结构检查：文件存在且大小 > 0（禁兜底——缺失/空文件判 fail） */
async function checkStructure(imagePath: string): Promise<{ pass: boolean; issues: string[] }> {
  try {
    await access(imagePath);
    const s = await stat(imagePath);
    if (s.size <= 0) {
      return { pass: false, issues: ['成品文件为空'] };
    }
    return { pass: true, issues: [] };
  } catch (error) {
    return { pass: false, issues: [`成品文件缺失: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

export interface MemeQcDeps {
  /** 语义层视觉质检（豆包视觉；测试注入 fake）；null = 无视觉能力时只用结构层 */
  vision?: (req: MemeVisionQcRequest) => Promise<{ pass: boolean; issues: string[] }>;
}

/** 创建表情包质检（真实实现；vision 缺省 = 只用结构层，仍可 mock） */
export function createMemeQc(deps: MemeQcDeps = {}): MemeQc {
  return {
    async inspect({ imagePath, copy, mode }) {
      const structural = await checkStructure(imagePath);
      if (!structural.pass) return structural;

      if (!deps.vision) {
        // 无视觉能力：结构过即收（部署无 ARK 视觉模型权限时仍可用，文档注明）
        return { pass: true, issues: [] };
      }
      try {
        const semantic = await deps.vision({ imagePath, copy, mode });
        return semantic;
      } catch (error) {
        // 视觉调用失败 ≠ 图不合格：显式 fail（禁兜底——不猜，宁可少收不误收）
        return {
          pass: false,
          issues: [`语义质检执行失败: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    },
  };
}

/** 便捷：用于 pipeline 的 QC（结构 + 可选语义） */
export { checkStructure };
