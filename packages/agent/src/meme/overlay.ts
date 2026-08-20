/**
 * 梗文字叠加（#96）—— 图文分离硬契约的核心
 *
 * 生图模型只画画面（ADR-0001 + 调研结论：AI 画整句中文不可靠，Glyph-ByT5
 * 基线 <20%），梗文字由这里用 PIL（服务器端）程序叠加，100% 正确、可读、
 * 可重排版。
 *
 * 两层：
 * - 纯函数层（可测）：layoutMemeText（按画布尺寸 + 文字长度算字号/行/描边）。
 * - I/O 层：applyOverlay（spawn python 脚本 meme-overlay.py 渲染，可注入
 *   spawn）。脚本退出码非 0 → 显式抛错（禁兜底）。
 *
 * 文字清晰可读的关键：自动缩字号（短文案大字号）+ 白字黑描边（经典梗图
 * 对比度）+ 底部横排居中。脚本内做实际绘制（PIL 测量中文宽度）。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import type { Overlay } from './types.js';

/** meme-overlay.py 绝对路径（本包 scripts/ 下，import.meta.url 锚定，不依赖 cwd） */
const MEME_OVERLAY_PY = fileURLToPath(
  new URL('../../scripts/meme-overlay.py', import.meta.url),
);

/** 注入式 spawn（测试 fake；真实实现见下方 realSpawn） */
export interface OverlaySpawnLike {
  (
    cmd: string,
    args: string[],
    opts: { timeoutMs: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** stderr 累积上限（防无界增长，只留排障尾巴） */
const STDERR_CAP_BYTES = 64 * 1024;

const realSpawn: OverlaySpawnLike = (cmd, args, { timeoutMs }) => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < STDERR_CAP_BYTES) stderr += chunk;
  });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({ exitCode: code ?? -1, stdout, stderr });
  });
  return promise;
};

export interface OverlayOptions {
  pythonCmd?: string;
  timeoutMs?: number;
  spawnFn?: OverlaySpawnLike;
}

/** 单行叠加布局（纯函数产物） */
export interface OverlayLayout {
  /** 计算出的字号（px，按宽度自适应缩放） */
  fontSize: number;
  /** 文本行数 */
  lines: number;
  /** 白字黑描边的描边宽度（px） */
  strokeWidth: number;
  /** 文字区与画布底部留白比例（0-1） */
  bottomMarginRatio: number;
}

/**
 * 纯函数：计算梗文字叠加布局（图文分离：这里只算排版参数，不画图）。
 * 规则：
 * - 字号随画布宽度缩放（width / targetChars ≈ 每字宽度），clamp 到 [24, 96]。
 * - 长文案自动换行（每行 ≤ maxChars 字符），行数 = ceil(len / maxChars)。
 * - 白字黑描边（对比度）随字号比例缩放。
 * 测试断言：短文案字号大 / 长文案自动换行多行 / 描边存在。
 */
export function layoutMemeText(
  text: string,
  opts: { canvasWidth: number; maxCharsPerLine?: number; minFont?: number; maxFont?: number },
): OverlayLayout {
  const maxCharsPerLine = opts.maxCharsPerLine ?? 12;
  const minFont = opts.minFont ?? 24;
  const maxFont = opts.maxFont ?? 96;
  const chars = [...text];
  const lines = Math.max(1, Math.ceil(chars.length / maxCharsPerLine));
  // 字号随画布宽度与最长行缩放：目标 = 画布宽 / 最长行字符数 * 0.75
  const longestLine = Math.min(chars.length, maxCharsPerLine);
  const rawFont = Math.round((opts.canvasWidth / longestLine) * 0.75);
  const fontSize = Math.max(minFont, Math.min(maxFont, rawFont));
  return {
    fontSize,
    lines,
    strokeWidth: Math.max(2, Math.round(fontSize / 10)),
    bottomMarginRatio: 0.05,
  };
}

/**
 * 创建文字叠加服务（真实实现；测试传 spawnFn 注入 fake）。
 * 输入画面（生图产物）→ 叠加梗文字 → 输出成品图。
 */
export function createOverlay(opts: OverlayOptions = {}): Overlay {
  const pythonCmd = opts.pythonCmd ?? 'python3';
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const spawnFn = opts.spawnFn ?? realSpawn;

  return {
    async apply(imagePath: string, text: string, outPath: string): Promise<string> {
      const { exitCode, stderr, stdout } = await spawnFn(
        pythonCmd,
        [MEME_OVERLAY_PY, imagePath, '--text', text, '--out', outPath],
        { timeoutMs },
      );
      if (exitCode !== 0) {
        const tail = (stderr || stdout).trim().slice(-500);
        throw new Error(`meme-overlay.py 失败（exit ${exitCode}）：${tail}`);
      }
      return outPath;
    },
  };
}
