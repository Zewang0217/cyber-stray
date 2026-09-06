/**
 * speak 工具 reason 落盘测试（#152 验收：speak reason 随记录落盘）
 *
 * 覆盖 registry/speak.ts execute 的合并逻辑：LLM 给出的 reason 与
 * quality hook 写入的扫描警告（ctx.gateReasons）合并进 meta.gateReasons，
 * 经 speak() 落入推送历史记录；归因话题（ctx.matchedTopics）同路落盘。
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { speakToolDef } from './speak.js';
import { todaySpeaksFile } from '../push/push-budget.js';
import { useTempDataDir, makeState } from '../../test/helpers.js';
import type { ToolContext } from './context.js';

/** ai SDK tool() 包装后的可执行形态（同 browse-page.test 的解包模式） */
interface ExecutableTool {
  execute: (args: { content: string; type: string; reason?: string }) => Promise<{
    success: boolean;
    pushed: boolean;
  }>;
}

function makeToolCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    state: makeState(),
    traceId: 'test-trace',
    stepCount: 0,
    wanderHistory: [],
    visitedUrls: [],
    spokeTimes: 0,
    pendingFeedbackCount: 0,
    endReason: 'rest',
    startTime: Date.now(),
    searchQueries: [],
    ...overrides,
  };
}

async function lastRecord(): Promise<Record<string, unknown>> {
  const raw = await readFile(
    join(process.env.DATA_DIR!, 'history', todaySpeaksFile()),
    'utf-8',
  );
  const lines = raw.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

describe('speak 工具 reason 落盘（#152）', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  test('LLM reason 与 hook 扫描警告合并写入记录 gateReasons，归因话题同路落盘', async () => {
    const ctx = makeToolCtx({
      gateReasons: ['URL 数量异常 (6 > 5)'],
      matchedTopics: ['互联网'],
    });
    const tool = speakToolDef.createTool(ctx) as unknown as ExecutableTool;

    const result = await tool.execute({
      content: '移动互联网的下半场，内容视角很新',
      type: 'article',
      reason: '命中主人中兴趣且视角新颖',
    });

    expect(result.success).toBe(true);
    const record = await lastRecord();
    expect(record.gateReasons).toEqual(['命中主人中兴趣且视角新颖', 'URL 数量异常 (6 > 5)']);
    expect(record.matchedTopics).toEqual(['互联网']);
  });

  test('无 reason 且无 hook 警告时 gateReasons 不落盘（字段缺省）', async () => {
    const tool = speakToolDef.createTool(makeToolCtx()) as unknown as ExecutableTool;

    const result = await tool.execute({ content: '喵。', type: 'nonsense' });

    expect(result.success).toBe(true);
    const record = await lastRecord();
    expect(record.gateReasons).toBeUndefined();
  });
});
