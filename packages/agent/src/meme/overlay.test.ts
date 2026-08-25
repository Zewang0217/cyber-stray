/**
 * 表情包文字叠加测试（#96）
 *
 * - layoutMemeText（纯函数）：短文案大字号 / 长文案自动换行多行 / 描边存在
 *   （文字清晰可读的可测维度）
 * - createOverlay.apply：spawn 脚本传对参数；脚本失败显式抛错（禁兜底）；
 *   text 与 imagePath 分离传入（图文分离：叠加的是文案，不是画面）
 */

import { describe, it, expect } from 'vitest';
import { layoutMemeText, createOverlay, type OverlaySpawnLike } from './overlay.js';

describe('layoutMemeText（纯函数）', () => {
  it('短文案 → 大字号、单行', () => {
    const layout = layoutMemeText('好耶', { canvasWidth: 1024 });
    expect(layout.lines).toBe(1);
    expect(layout.fontSize).toBeGreaterThanOrEqual(24);
  });

  it('长文案 → 自动换行多行', () => {
    const long = '量子纠缠人生纠缠今天也是又菜又爱玩的一天啊';
    const layout = layoutMemeText(long, { canvasWidth: 1024, maxCharsPerLine: 8 });
    expect(layout.lines).toBeGreaterThan(1);
  });

  it('字号随画布宽度缩放（窄画布字号 ≤ 宽画布）', () => {
    const narrow = layoutMemeText('短', { canvasWidth: 320 });
    const wide = layoutMemeText('短', { canvasWidth: 1024 });
    expect(narrow.fontSize).toBeLessThanOrEqual(wide.fontSize);
  });

  it('白字黑描边：strokeWidth 存在且随字号', () => {
    const layout = layoutMemeText('好耶', { canvasWidth: 1024 });
    expect(layout.strokeWidth).toBeGreaterThanOrEqual(2);
  });
});

describe('createOverlay.apply', () => {
  it('调用脚本叠加文字（imagePath/text/out 分离传入），返回 outPath', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const fakeSpawn: OverlaySpawnLike = async (cmd, args, _opts) => {
      calls.push({ cmd, args });
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };
    const overlay = createOverlay({ spawnFn: fakeSpawn });
    const out = await overlay.apply('/img/raw.png', '梗文案', '/img/final.png');
    expect(out).toBe('/img/final.png');
    expect(calls).toHaveLength(1);
    const { cmd, args } = calls[0]!;
    expect(cmd).toBe('python3');
    expect(args.join(' ')).toContain('meme-overlay.py');
    expect(args.join(' ')).toContain('/img/raw.png');
    expect(args.join(' ')).toContain('梗文案');
    expect(args.join(' ')).toContain('/img/final.png');
    // 图文分离：文案作为 --text 参数传入脚本，不混入画面 prompt
    expect(args.join(' ')).toMatch(/--text 梗文案/);
  });

  it('脚本失败（exit != 0）→ 显式抛错（禁兜底）', async () => {
    const fakeSpawn: OverlaySpawnLike = async () => {
      return { exitCode: 1, stdout: '', stderr: '缺少字体' };
    };
    const overlay = createOverlay({ spawnFn: fakeSpawn });
    await expect(overlay.apply('/a.png', 't', '/b.png')).rejects.toThrow(/meme-overlay\.py 失败/);
  });
});
