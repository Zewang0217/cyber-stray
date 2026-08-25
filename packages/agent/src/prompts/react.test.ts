/**
 * 性格语气注入测试（#90）
 *
 * 契约：buildReactSystemPrompt 注入性格语气段——不同性格的 prompt
 * 可感知差异（acceptance：性格影响 agent 说话语气）。
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { buildReactSystemPrompt } from './react.js';
import { loadUserProfile } from '../memory/user-profile.js';
import { useTempDataDir, makeState } from '../test/helpers.js';

describe('buildReactSystemPrompt 性格语气注入', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  test('默认配置（好奇）：prompt 含好奇性格段与语气描述', async () => {
    const profile = await loadUserProfile();
    const prompt = buildReactSystemPrompt(makeState(), profile);
    expect(prompt).toContain('**你的性格（塑造你说话的语气）：**');
    expect(prompt).toContain('好奇');
    expect(prompt).toContain('好奇心旺盛');
  });

  test('慵懒性格：prompt 注入慵懒语气段，与好奇可感知差异', async () => {
    const profile = await loadUserProfile();
    const lazyPrompt = buildReactSystemPrompt(makeState(), profile);
    // 通过租户上下文注入慵懒配置（loadConfig + setTenantContext）
    const { loadConfig, setTenantContext } = await import('../config.js');
    const lazyConfig = loadConfig(undefined, undefined, undefined, 'lazy');
    setTenantContext({ tenantId: 't-lazy', dataDir: process.env.DATA_DIR!, config: lazyConfig });
    try {
      const prompt = buildReactSystemPrompt(makeState(), profile);
      expect(prompt).toContain('慵懒');
      expect(prompt).toContain('能躺着就不坐着');
      expect(prompt).not.toContain('好奇心旺盛');
      // 与好奇默认段明确不同
      expect(prompt).not.toBe(lazyPrompt);
    } finally {
      setTenantContext(null);
    }
  });

  test('活泼/沉稳：语气段随注册表变化（注册表驱动而非硬编码）', async () => {
    const profile = await loadUserProfile();
    const { loadConfig, setTenantContext } = await import('../config.js');
    const { getPersonality } = await import('@cyber-stray/shared');
    for (const id of ['playful', 'steady'] as const) {
      const cfg = loadConfig(undefined, undefined, undefined, id);
      setTenantContext({ tenantId: `t-${id}`, dataDir: process.env.DATA_DIR!, config: cfg });
      try {
        const prompt = buildReactSystemPrompt(makeState(), profile);
        expect(prompt).toContain(getPersonality(id).name);
        expect(prompt).toContain(getPersonality(id).tonePrompt.slice(0, 12));
      } finally {
        setTenantContext(null);
      }
    }
  });
});

describe('buildReactSystemPrompt 猫人设（#114 切片 1）', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  test('自称电子流浪猫,不再有电子流浪狗/汪!', async () => {
    const profile = await loadUserProfile();
    const prompt = buildReactSystemPrompt(makeState(), profile);
    expect(prompt).toContain('电子流浪猫');
    expect(prompt).not.toContain('电子流浪狗');
    expect(prompt).not.toContain('汪！');
  });
});

describe('buildReactSystemPrompt 缓存顺序（#113/#114 切片 4）', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  /** 固定段锚点文本（跨轮不变）与动态段锚点 */
  const FIXED_ANCHORS = [
    '电子流浪猫',
    '**你的性格（塑造你说话的语气）：**',
    '**你的口头禅（你说话的招牌——自然地用出来）：**',
    '**输出语言：**',
    '**搜索建议：**',
    '**行为准则（必须遵守）：**',
    '**注意：**',
    '**记忆工具：**',
  ];
  const DYNAMIC_ANCHORS = [
    '**你当前的状态：**',
    '**你的兴趣（按当前热情排序）：**',
    '**你的主人画像',
  ];

  test('固定段全部在动态段之前（prompt cache 前缀命中结构）', async () => {
    const profile = await loadUserProfile();
    const prompt = buildReactSystemPrompt(makeState(), profile);
    const firstDynamic = Math.min(
      ...DYNAMIC_ANCHORS.map((a) => prompt.indexOf(a)),
    );
    for (const anchor of FIXED_ANCHORS) {
      const idx = prompt.indexOf(anchor);
      expect(idx, `固定段 ${anchor} 应存在`).toBeGreaterThanOrEqual(0);
      expect(idx, `固定段 ${anchor} 应在动态段之前`).toBeLessThan(firstDynamic);
    }
  });

  test('口头禅段在固定段末尾：重写不改变其前的前缀（缓存命中不受影响）', async () => {
    const profile = await loadUserProfile();
    const { loadConfig, setTenantContext } = await import('../config.js');
    const before = buildReactSystemPrompt(makeState(), profile);
    // 注入不同口头禅集合（模拟反馈归因低频重写）
    setTenantContext({
      tenantId: 't-catchphrase',
      dataDir: process.env.DATA_DIR!,
      config: loadConfig(
        undefined,
        undefined,
        undefined,
        'curious',
        [{ text: '重写后的口头禅', weight: 3 }],
      ),
    });
    try {
      const after = buildReactSystemPrompt(makeState(), profile);
      const anchor = '**你的口头禅（你说话的招牌——自然地用出来）：**';
      const prefixLen = after.indexOf(anchor);
      expect(prefixLen).toBeGreaterThan(0);
      // 口头禅段之前的所有固定文本逐字一致 → 前缀缓存命中不受重写影响
      expect(after.slice(0, prefixLen)).toBe(before.slice(0, prefixLen));
      // 口头禅确实变了（重写生效）
      expect(after).toContain('重写后的口头禅');
      // 口头禅段是固定段最后一块：其后到动态分隔符之间无其他固定锚点
      const dynAnchor = '─── 以下为本次游荡的动态上下文（每轮变化） ───';
      const between = after.slice(prefixLen, after.indexOf(dynAnchor));
      for (const fixed of ['**输出语言：**', '**行为准则（必须遵守）：**', '**记忆工具：**']) {
        expect(between, `${fixed} 应在口头禅段之前`).not.toContain(fixed);
      }
    } finally {
      setTenantContext(null);
    }
  });

  test('同轮多步共享前缀：状态/兴趣/画像变化不改固定前缀', async () => {
    const profile = await loadUserProfile();
    const s1 = makeState();
    const s2 = makeState({ energy: 10, boredom: 95, mood: 'grumpy' });
    const p1 = buildReactSystemPrompt(s1, profile);
    const p2 = buildReactSystemPrompt(s2, profile);
    const anchor = '─── 以下为本次游荡的动态上下文（每轮变化） ───';
    const split1 = p1.indexOf(anchor);
    const split2 = p2.indexOf(anchor);
    expect(split1).toBeGreaterThan(0);
    expect(split2).toBeGreaterThan(0);
    // 动态分隔符之前的固定段逐字一致 → 同轮多步 LLM 调用共享前缀缓存
    expect(p1.slice(0, split1)).toBe(p2.slice(0, split2 === split1 ? split2 : split1));
  });
});
