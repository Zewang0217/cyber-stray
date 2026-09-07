/**
 * 存量图谱去污染（#176 / ADR 配套）：对租户 user-interests.json 跑话题准入
 * 校验，把 URL/搜索 query 形态的节点隔离到 user-interests.quarantine.json
 * （不丢，可人工回捞），其余保留。
 *
 * 用法：bun src/migration/clean-interest-graph.ts <tenant-data-dir>
 * 幂等：清洗后再跑 = 0 隔离（准入校验挡住新污染后存量只减不增）。
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { isPlausibleTopic } from '../memory/topic-validator.js';

interface InterestNode {
  id: string;
  weight: number;
  [key: string]: unknown;
}

export interface GraphCleanReport {
  ranAt: string;
  file: string;
  total: number;
  kept: number;
  quarantined: number;
  /** 被隔离的节点（id + 全量字段），随 report 留档 */
  quarantinedNodes: InterestNode[];
}

/** 清洗单个图谱文件；返回 report。污染节点写入 <file 同名>.quarantine.json */
export async function cleanInterestGraphFile(filePath: string): Promise<GraphCleanReport> {
  const raw = await readFile(filePath, 'utf-8');
  const graph = JSON.parse(raw) as { nodes?: unknown; lastUpdated?: unknown };
  if (!Array.isArray(graph.nodes)) {
    throw new Error(`图谱形状非法（nodes 不是数组）: ${filePath}`);
  }

  const nodes = graph.nodes as InterestNode[];
  const kept = nodes.filter((n) => isPlausibleTopic(String(n.id ?? '')));
  const quarantinedNodes = nodes.filter((n) => !isPlausibleTopic(String(n.id ?? '')));

  if (quarantinedNodes.length > 0) {
    const cleaned = { ...graph, nodes: kept, lastUpdated: new Date().toISOString() };
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(cleaned, null, 2), 'utf-8');
    await rename(tmp, filePath);

    const quarantinePath = filePath.replace(/\.json$/, '.quarantine.json');
    let prior: InterestNode[] = [];
    try {
      const prev = JSON.parse(await readFile(quarantinePath, 'utf-8')) as InterestNode[];
      if (Array.isArray(prev)) prior = prev;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const qTmp = `${quarantinePath}.tmp`;
    await writeFile(qTmp, JSON.stringify([...prior, ...quarantinedNodes], null, 2), 'utf-8');
    await rename(qTmp, quarantinePath);
  }

  return {
    ranAt: new Date().toISOString(),
    file: filePath,
    total: nodes.length,
    kept: kept.length,
    quarantined: quarantinedNodes.length,
    quarantinedNodes,
  };
}

const isDirectRun = process.argv[1]?.endsWith('clean-interest-graph.ts');

if (isDirectRun) {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('用法: bun src/migration/clean-interest-graph.ts <tenant-data-dir>');
    process.exit(2);
  }
  cleanInterestGraphFile(join(dataDir, 'user-interests.json'))
    .then((report) => {
      console.log(JSON.stringify({ ok: true, report }));
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      process.exit(1);
    });
}
