import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { useTempDataDir } from '../test/helpers.js';
import { resolveTopicsFromHistory, runFeedbackWorker } from './feedback-cli.js';
import { getInterestGraph, _resetInterestGraphCache } from '../memory/interest-graph.js';
import { readFile } from 'fs/promises';

describe('feedback-cli（S9 REST 反馈 worker 入口）', () => {
  let dataDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    cleanup = temp.cleanup;
    dataDir = temp.dataDir;
    _resetInterestGraphCache();
  });

  afterEach(() => {
    cleanup();
  });

  async function seedSpeaks(lines: Array<Record<string, unknown>>): Promise<void> {
    await mkdir(join(dataDir, 'history'), { recursive: true });
    const file = join(dataDir, 'history', 'speaks-2026-08-15.jsonl');
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  }

  describe('resolveTopicsFromHistory：speaks 历史反查归因', () => {
    it('按 messageId 找到 matchedTopics（最新文件优先）', async () => {
      await mkdir(join(dataDir, 'history'), { recursive: true });
      await writeFile(
        join(dataDir, 'history', 'speaks-2026-08-14.jsonl'),
        JSON.stringify({ messageId: 'om-1', matchedTopics: ['旧话题'] }) + '\n',
        'utf-8',
      );
      await writeFile(
        join(dataDir, 'history', 'speaks-2026-08-15.jsonl'),
        JSON.stringify({ messageId: 'om-1', matchedTopics: ['量子计算', '科技'] }) + '\n',
        'utf-8',
      );

      expect(await resolveTopicsFromHistory(dataDir, 'om-1')).toEqual(['量子计算', '科技']);
    });

    it('messageId 不存在或记录无 matchedTopics → null', async () => {
      await seedSpeaks([{ messageId: 'om-other', matchedTopics: ['AI'] }, { messageId: 'om-x' }]);
      expect(await resolveTopicsFromHistory(dataDir, 'om-1')).toBeNull();
      expect(await resolveTopicsFromHistory(dataDir, 'om-x')).toBeNull();
    });

    it('历史目录缺失（租户未游荡）→ null 而非报错', async () => {
      expect(await resolveTopicsFromHistory(dataDir, 'om-1')).toBeNull();
    });
  });

  describe('runFeedbackWorker：like/dislike/boost 分发', () => {
    it('like：历史归因 → 兴趣强化 → feedback.json 记录', async () => {
      await mkdir(join(dataDir, 'memory'), { recursive: true });
      const graph = getInterestGraph();
      graph.addInterest('量子计算', 0.3);
      const before = graph.getNode('量子计算')!.weight;
      await seedSpeaks([{ messageId: 'om-1', matchedTopics: ['量子计算'] }]);

      const result = await runFeedbackWorker({
        dataDir,
        action: 'feedback',
        type: 'like',
        messageId: 'om-1',
        userId: 'user-1',
      });

      expect(result.topicsMatched).toBe(true);
      expect(result.interestReinforced).toBe(true);
      expect(graph.getNode('量子计算')!.weight).toBeGreaterThan(before);

      const store = JSON.parse(
        await readFile(join(dataDir, 'feedback.json'), 'utf-8'),
      ) as { feedbacks: Array<{ type: string; messageId?: string }> };
      expect(store.feedbacks[0]?.type).toBe('like');
      expect(store.feedbacks[0]?.messageId).toBe('om-1');
    });

    it('boost：直接按 topic 强化（新话题 feedback 来源入图）', async () => {
      await mkdir(join(dataDir, 'memory'), { recursive: true });

      const result = await runFeedbackWorker({
        dataDir,
        action: 'boost',
        topic: '天文摄影',
        userId: 'user-1',
      });

      expect(result.interestReinforced).toBe(true);
      const graph = getInterestGraph();
      expect(graph.getNode('天文摄影')!.source).toBe('feedback');
    });
  });
});
