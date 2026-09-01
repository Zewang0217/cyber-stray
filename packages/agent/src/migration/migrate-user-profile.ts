/**
 * 用户画像目录化迁移（S1 #150）
 *
 * 一次性数据迁移：旧扁平 `interests.json` + `memory/user-profile.json` →
 * `user-profile/` 目录化结构（identity / settings / user-interests / profile-summary）
 * + `curiosity-interests.json` 骨架。
 *
 * 语义（与 #150 验收对齐）：
 * - 旧图谱节点 → 一级节点（parent 缺省 = 根；path = id），零丢失
 * - 旧画像 likes/dislikes → 匹配一级节点落 exemplars/negativeExemplars
 *   （精确优先，长文本包含扫描；未命中进 report.unmapped，不静默丢弃）
 * - sampleCount/confidence 保留为阻尼参数（slim 画像：不再含 likes/dislikes）
 * - 旧文件保留不动（备份语义）→ 可回放：重跑时新文件已存在即跳过（幂等）
 *
 * 生产执行 = CLI（src/worker/migrate-cli.ts），由用户跑；agent 运行时不做自动迁移。
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { consola } from '../logger.js';
import {
  USER_INTERESTS_FILE,
  LEGACY_INTERESTS_FILE,
  InterestNodeSchema,
  type InterestNode,
} from '../memory/interest-graph.js';
import { createDefaultCuriosityData } from '../memory/curiosity-interests.js';

const logger = consola.withTag('MigrateUserProfile');

/** 旧画像文件（迁移来源） */
const LEGACY_PROFILE_FILE = 'memory/user-profile.json';
/** 目录化后的派生摘要占位 */
const PROFILE_SUMMARY_FILE = 'user-profile/profile-summary.md';
/** 目录化后的身份占位（字段由后续 slice 填充） */
const IDENTITY_FILE = 'user-profile/identity.json';
/** 目录化后的推送偏好占位（S11 预算相关，后续 slice 填充） */
const SETTINGS_FILE = 'user-profile/settings.json';
/** 好奇图谱骨架文件 */
const CURIOSITY_FILE = 'curiosity-interests.json';
/** 迁移报告（回放验证「旧数据零丢失」的依据） */
const MIGRATION_REPORT_FILE = 'user-profile/migration-report.json';

export interface MigrationStats {
  /** 旧图谱迁移的一级节点数 */
  sourceInterests: number;
  likesTotal: number;
  likesMapped: number;
  dislikesTotal: number;
  dislikesMapped: number;
  /** 未命中任何节点的原文（不丢，记录备查） */
  unmappedLikes: string[];
  unmappedDislikes: string[];
  /** 旧画像阻尼参数（保留给 S2） */
  sampleCount: number | null;
  confidence: number | null;
}

export interface MigrationReport {
  version: 1;
  migratedAt: string;
  status: 'migrated' | 'already-migrated';
  stats: MigrationStats;
  createdFiles: string[];
  /** 图谱/画像已迁移过（幂等重跑）时为 true */
  skipped: boolean;
}

function emptyStats(): MigrationStats {
  return {
    sourceInterests: 0,
    likesTotal: 0,
    likesMapped: 0,
    dislikesTotal: 0,
    dislikesMapped: 0,
    unmappedLikes: [],
    unmappedDislikes: [],
    sampleCount: null,
    confidence: null,
  };
}

/** 旧图谱节点解析（宽松：逐节点 v2 schema 校验；坏节点进 unmapped 不丢） */
function parseLegacyNodes(raw: unknown): { nodes: InterestNode[]; invalid: unknown[] } {
  const nodes: InterestNode[] = [];
  const invalid: unknown[] = [];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { nodes?: unknown }).nodes)) {
    for (const item of (raw as { nodes: unknown[] }).nodes) {
      const parsed = InterestNodeSchema.safeParse(item);
      if (parsed.success) {
        nodes.push(parsed.data);
      } else {
        invalid.push(item);
      }
    }
  }
  return { nodes, invalid };
}

/**
 * 匹配反馈文本到图谱节点：精确优先，其次双向包含扫描。
 * 匹配语义与 push-gate 的 matchInterest 不同——这里是"消解迁移"，
 * 接受长文本（如「有故事性的天文发现」）挂到含子串的节点。
 */
function matchNode(nodes: InterestNode[], text: string): InterestNode | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const exact = nodes.find((n) => n.id.toLowerCase() === t);
  if (exact) return exact;
  return nodes.find(
    (n) => t.includes(n.id.toLowerCase()) || n.id.toLowerCase().includes(t),
  );
}

/** 写文件（父目录自动建） */
async function writeJson(path: string, data: unknown): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/')) || '.';
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

/** 占位文件（缺失才建；已存在不覆盖） */
async function ensurePlaceholder(path: string, content: string): Promise<boolean> {
  if (existsSync(path)) return false;
  const dir = path.substring(0, path.lastIndexOf('/')) || '.';
  await mkdir(dir, { recursive: true });
  await writeFile(path, content, 'utf-8');
  return true;
}

/**
 * 执行迁移（幂等）。
 * @param dataDir 租户数据根目录（CLI 传 --dataDir；单机 = DATA_DIR）
 */
export async function migrateUserProfile(dataDir: string): Promise<MigrationReport> {
  const migratedAt = new Date().toISOString();
  const userInterestsPath = join(dataDir, USER_INTERESTS_FILE);
  const createdFiles: string[] = [];

  // 幂等：新图谱已存在 → 跳过核心迁移，只补缺失的占位文件
  const alreadyMigrated = existsSync(userInterestsPath);
  if (alreadyMigrated) {
    logger.info('user-interests.json 已存在，跳过图谱/画像迁移（幂等重跑）', {
      path: userInterestsPath,
    });
  }

  const stats = emptyStats();
  const profilePath = join(dataDir, LEGACY_PROFILE_FILE);

  if (!alreadyMigrated) {
    // 1. 旧图谱 → 一级节点（path = id，parent 缺省 = 根）
    const legacyPath = join(dataDir, LEGACY_INTERESTS_FILE);
    let nodes: InterestNode[] = [];
    if (existsSync(legacyPath)) {
      try {
        const raw = JSON.parse(await readFile(legacyPath, 'utf-8'));
        const parsed = parseLegacyNodes(raw);
        nodes = parsed.nodes.map((n) => ({ ...n, path: n.id }));
        stats.sourceInterests = parsed.nodes.length;
        if (parsed.invalid.length > 0) {
          logger.warn('旧图谱存在无法校验的节点，已记录进报告（不丢）', {
            invalidCount: parsed.invalid.length,
          });
          stats.unmappedDislikes.push(
            ...parsed.invalid.map((v) => `[invalid-node] ${JSON.stringify(v).slice(0, 120)}`),
          );
        }
      } catch (error) {
        logger.error('旧图谱解析失败（跳过图谱迁移，节点数 0）', {
          path: legacyPath,
          error,
        });
        stats.unmappedDislikes.push(`[legacy-interests-unreadable] ${String(error).slice(0, 160)}`);
      }
    }

    // 2. 旧画像 likes/dislikes → 节点 exemplars；阻尼参数保留
    if (existsSync(profilePath)) {
      try {
        const raw = JSON.parse(await readFile(profilePath, 'utf-8')) as {
          likes?: string[];
          dislikes?: string[];
          sampleCount?: number;
          confidence?: number;
          lastUpdated?: string;
          feedbackCount?: number;
          lastProfileUpdateAt?: string | null;
        };
        const likes = Array.isArray(raw.likes) ? raw.likes : [];
        const dislikes = Array.isArray(raw.dislikes) ? raw.dislikes : [];
        stats.likesTotal = likes.length;
        stats.dislikesTotal = dislikes.length;
        stats.sampleCount = typeof raw.sampleCount === 'number' ? raw.sampleCount : null;
        stats.confidence = typeof raw.confidence === 'number' ? raw.confidence : null;

        for (const like of likes) {
          const node = matchNode(nodes, like);
          if (node) {
            node.exemplars = [...(node.exemplars ?? []), like];
            stats.likesMapped += 1;
          } else {
            stats.unmappedLikes.push(like);
          }
        }
        for (const dislike of dislikes) {
          const node = matchNode(nodes, dislike);
          if (node) {
            node.negativeExemplars = [...(node.negativeExemplars ?? []), dislike];
            stats.dislikesMapped += 1;
          } else {
            stats.unmappedDislikes.push(dislike);
          }
        }

        // 3. slim 画像写回（无 likes/dislikes 字段 = 单写者纪律）
        const slim: Record<string, unknown> = {
          lastUpdated: raw.lastUpdated ?? migratedAt,
          feedbackCount: raw.feedbackCount ?? 0,
          sampleCount: raw.sampleCount ?? 0,
          confidence: raw.confidence ?? 0,
          lastProfileUpdateAt: raw.lastProfileUpdateAt ?? null,
        };
        await writeJson(profilePath, slim);
        createdFiles.push(LEGACY_PROFILE_FILE);
      } catch (error) {
        logger.error('旧画像解析失败（跳过画像消解）', {
          path: profilePath,
          error,
        });
        stats.unmappedDislikes.push(`[legacy-profile-unreadable] ${String(error).slice(0, 160)}`);
      }
    }

    // 4. 新图谱落盘（v2）
    await writeJson(userInterestsPath, {
      version: 2,
      lastUpdated: migratedAt,
      nodes,
    });
    createdFiles.push(USER_INTERESTS_FILE);
  }

  // 5. 占位文件：identity / settings / profile-summary / curiosity 骨架
  const now = migratedAt;
  if (await ensurePlaceholder(join(dataDir, IDENTITY_FILE), JSON.stringify({
    version: 1,
    createdAt: now,
    name: null,
  }, null, 2))) {
    createdFiles.push(IDENTITY_FILE);
  }
  if (await ensurePlaceholder(join(dataDir, SETTINGS_FILE), JSON.stringify({
    version: 1,
    createdAt: now,
    pushBudget: null,
  }, null, 2))) {
    createdFiles.push(SETTINGS_FILE);
  }
  if (await ensurePlaceholder(join(dataDir, PROFILE_SUMMARY_FILE), [
    '# profile-summary（派生摘要）',
    '',
    '> S1 占位：由反思时从图谱增量生成（S2/S4），不独立维护。',
    '',
  ].join('\n'))) {
    createdFiles.push(PROFILE_SUMMARY_FILE);
  }
  if (await ensurePlaceholder(join(dataDir, CURIOSITY_FILE), JSON.stringify(
    createDefaultCuriosityData(),
    null,
    2,
  ))) {
    createdFiles.push(CURIOSITY_FILE);
  }

  // 6. 迁移报告
  const report: MigrationReport = {
    version: 1,
    migratedAt,
    status: alreadyMigrated ? 'already-migrated' : 'migrated',
    stats,
    createdFiles,
    skipped: alreadyMigrated,
  };
  await writeJson(join(dataDir, MIGRATION_REPORT_FILE), report);
  createdFiles.push(MIGRATION_REPORT_FILE);

  logger.info('用户画像迁移完成', {
    status: report.status,
    sourceInterests: stats.sourceInterests,
    likesMapped: `${stats.likesMapped}/${stats.likesTotal}`,
    dislikesMapped: `${stats.dislikesMapped}/${stats.dislikesTotal}`,
    unmapped: stats.unmappedLikes.length + stats.unmappedDislikes.length,
    createdFiles: createdFiles.length,
  });

  return report;
}