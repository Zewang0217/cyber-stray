/**
 * SIGKILL 注入测试的子进程夹具（state.test.ts 拉起，不经 vitest）
 *
 * 循环 saveState 大状态对象，每次成功后在 DATA_DIR 下重建 marker 文件——
 * 父进程见到 marker 即 SIGKILL。父进程随后校验 state.json 仍可解析：
 * 若 saveState 非原子（裸 writeFile），杀在写入中途会留截断文件。
 * DATA_DIR 由父进程 env 注入（与 useTempDataDir 同源）。
 */
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { saveState } from '../agent/state.js';
import { getDataPath } from '../config.js';
import { makeState } from './helpers.js';

/** 放大单次写入时长，提高 SIGKILL 落在写入窗口内的概率 */
function bigState(round: number) {
  return makeState({
    totalWanders: round,
    recentTopics: Array.from({ length: 400 }, (_, i) => `topic-${round}-${i}-${'x'.repeat(200)}`),
  });
}

async function main(): Promise<void> {
  const marker = join(getDataPath('.'), 'state-kill-marker');
  let round = 0;
  // 自毁保险丝：即使父进程的 SIGKILL 落在 tsx 壳上、node 实体变孤儿，
  // 也会在 60s 后自行退出，不会成为无限写盘的失控进程
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) process.exit(0);
    await saveState(bigState(round));
    round += 1;
    await writeFile(marker, String(round), 'utf-8');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
