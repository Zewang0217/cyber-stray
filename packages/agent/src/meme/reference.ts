/**
 * IP 表情包参考图 —— 宠物概念图 → 白底 JPEG
 *
 * IP 模式用宠物概念图锁角色（ADR-0001 参考图机制）。概念图是透明底 PNG
 * （pet-assets/concept.png），Seedream 参考图 image 字段用 data URL，
 * 透明 PNG 体积大 → 用 pet-sheet.py --flatten 压成白底 JPEG（与 CP
 * petgen splitter 同一脚本、同一模式；小图省带宽、更稳）。
 *
 * 依赖注入 spawn（测试 fake）；脚本路径 import.meta.url 仓库内锚定。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { access, mkdir, readFile } from 'fs/promises';
import { basename, join } from 'path';
import { z } from 'zod';

/** pet-sheet.py 绝对路径（仓库根 scripts/；与 CP splitter 同一脚本） */
const PET_SHEET_PY = fileURLToPath(
  new URL('../../../../scripts/pet-sheet.py', import.meta.url),
);

const PetReferenceManifestSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  spec: z.object({ specText: z.string().min(1) }),
  concept: z.literal('concept.png').optional(),
});

/** 当前租户已交付角色的参考图；无 manifest 表示尚无定制形象。 */
export async function resolvePetReference(dataDir: string): Promise<{ path: string; specText: string } | null> {
  const assetsDir = join(dataDir, 'pet-assets');
  let raw: string;
  try {
    raw = await readFile(join(assetsDir, 'manifest.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const manifest = PetReferenceManifestSchema.parse(JSON.parse(raw) as unknown);
  const file = manifest.concept ?? (manifest.version === 2 ? 'adopt-reference.jpg' : undefined);
  if (!file) throw new Error('宠物 manifest 缺角色参考图');
  const path = join(assetsDir, file);
  await access(path);
  return { path, specText: manifest.spec.specText };
}

/** PNG 概念图沿用白底压平链路；领养 JPG 已经是可用参考图。 */
export async function preparePetMemeReference(
  dataDir: string,
  abortSignal?: AbortSignal,
): Promise<{ path: string; specText: string } | null> {
  abortSignal?.throwIfAborted();
  const reference = await resolvePetReference(dataDir);
  if (!reference) return null;
  if (!reference.path.endsWith('.png')) return reference;
  const flatten = createFlattenReference();
  return { ...reference, path: await flatten(reference.path, join(dataDir, 'meme-assets', '.ref'), abortSignal) };
}

/** 注入式 spawn（测试 fake） */
export type RefSpawnLike = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; abortSignal?: AbortSignal },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const realSpawn: RefSpawnLike = (cmd, args, { timeoutMs, abortSignal }) => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: abortSignal });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
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

export interface FlattenReferenceOptions {
  pythonCmd?: string;
  timeoutMs?: number;
  spawnFn?: RefSpawnLike;
  /** 压平边长（白底 JPEG 参考输入；默认 384 与 #94 同） */
  frame?: number;
}

/** 概念图是否存在（IP 模式可用性判定） */
export async function conceptExists(dataDir: string): Promise<boolean> {
  try {
    await access(join(dataDir, 'pet-assets', 'concept.png'));
    return true;
  } catch {
    return false;
  }
}

/** 宠物概念图路径（IP 模式输入） */
export function conceptPath(dataDir: string): string {
  return join(dataDir, 'pet-assets', 'concept.png');
}

/**
 * 把宠物概念图压成白底 JPEG 参考图。返回参考图路径。
 * 脚本退出码非 0 / 产物缺失 → 显式抛错（禁兜底）。
 */
export function createFlattenReference(opts: FlattenReferenceOptions = {}) {
  const pythonCmd = opts.pythonCmd ?? 'python3';
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const spawnFn = opts.spawnFn ?? realSpawn;
  const frame = opts.frame ?? 384;

  return async (srcPath: string, outDir: string, abortSignal?: AbortSignal): Promise<string> => {
    await mkdir(outDir, { recursive: true });
    const { exitCode, stderr, stdout } = await spawnFn(
      pythonCmd,
      [PET_SHEET_PY, srcPath, '--flatten', '--frame', String(frame), '--out', outDir],
      { timeoutMs, abortSignal },
    );
    if (exitCode !== 0) {
      const tail = (stderr || stdout).trim().slice(-500);
      throw new Error(`pet-sheet.py 压平失败（exit ${exitCode}）：${tail}`);
    }
    const produced = join(outDir, `${basename(srcPath, '.png')}.jpg`);
    try {
      await access(produced);
    } catch {
      throw new Error(`参考图产物缺失: ${produced}`);
    }
    return produced;
  };
}
