import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFile } from 'fs/promises';
import { loadState, saveState, updateState } from './state.js';
import { getDataPath } from '../config.js';
import { useTempDataDir, makeState } from '../test/helpers.js';

describe('agent/state', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  test('loadState 首次：返回默认状态', async () => {
    const state = await loadState();
    expect(state.boredom).toBe(30);
    expect(state.mood).toBe('curious');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.totalWanders).toBe(0);
  });

  test('save→load 往返一致', async () => {
    const custom = makeState({ mood: 'grumpy', temper: 75, totalWanders: 9 });
    await saveState(custom);

    const got = await loadState();
    expect(got.mood).toBe('grumpy');
    expect(got.temper).toBe(75);
    expect(got.totalWanders).toBe(9);
  });

  test('updateState 部分更新合并，不覆盖未涉及字段', async () => {
    await saveState(makeState({ boredom: 40, energy: 90 }));
    await updateState({ mood: 'excited' });

    const got = await loadState();
    expect(got.mood).toBe('excited');
    expect(got.boredom).toBe(40);
    expect(got.energy).toBe(90);
  });

  test('loadState 容错：非法 JSON 回退默认且不抛错', async () => {
    await writeFile(getDataPath('state.json'), '{ 这不是合法 json', 'utf-8');

    const state = await loadState();
    expect(state.boredom).toBe(30);
    expect(state.mood).toBe('curious');
  });
});
