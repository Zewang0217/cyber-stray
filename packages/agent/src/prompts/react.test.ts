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
