/**
 * SkillIndex - Skill 文件系统索引
 *
 * 管理 data/skills/<name>/SKILL.md 的扫描、创建、加载和更新。
 * 使用 fs sync 方法（文件管理，非热路径 I/O）。
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { getDataPath, getDataRoot } from '../../../config.js';
import { consola } from '../../../logger.js';
import { parseSkillFile, type ParsedSkill } from './parser.js';

const logger = consola.withTag('browser:skill-index');

/** 索引条目（轻量元数据） */
export interface SkillIndexEntry {
  name: string;
  description: string;
  filePath: string;
}

const SKILL_NAME_RE = /^[a-z0-9-]+$/;
const MAX_NAME_LENGTH = 64;

export class SkillIndex {
  private entries: Map<string, SkillIndexEntry> = new Map();
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * 扫描 skillsDir，构建内存索引
   * 对每个子目录检查 SKILL.md 是否存在并解析 frontmatter
   */
  scan(): void {
    this.entries.clear();

    if (!existsSync(this.skillsDir)) {
      return;
    }

    const items = readdirSync(this.skillsDir);
    for (const item of items) {
      const itemPath = join(this.skillsDir, item);
      try {
        if (!statSync(itemPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const skillMdPath = join(itemPath, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      try {
        const raw = readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillFile(raw, skillMdPath);
        this.entries.set(parsed.meta.name, {
          name: parsed.meta.name,
          description: parsed.meta.description,
          filePath: skillMdPath,
        });
      } catch (error) {
        // 解析失败的文件跳过，不阻塞整体扫描，但记录警告
        logger.warn(`Skill 文件解析失败，已跳过: ${skillMdPath}`, { error: String(error) });
      }
    }
  }

  /** 列出所有已索引的 skill 元数据 */
  list(): SkillIndexEntry[] {
    return Array.from(this.entries.values());
  }

  /** 加载指定 skill 的完整内容 */
  load(name: string): ParsedSkill | null {
    const entry = this.entries.get(name);
    if (!entry) return null;

    try {
      const raw = readFileSync(entry.filePath, 'utf-8');
      return parseSkillFile(raw, entry.filePath);
    } catch {
      return null;
    }
  }

  /**
   * 创建新 skill
   *
   * @returns 创建的 SKILL.md 文件路径
   * @throws 如果 name 格式无效或 skill 已存在
   */
  create(name: string, description: string, content: string): string {
    this.validateName(name);

    if (this.entries.has(name)) {
      throw new Error(`Skill "${name}" 已存在，请使用 patch 更新`);
    }

    const skillDir = join(this.skillsDir, name);
    mkdirSync(skillDir, { recursive: true });

    const filePath = join(skillDir, 'SKILL.md');
    const fileContent = this.buildSkillMd(name, description, content);
    writeFileSync(filePath, fileContent, 'utf-8');

    // 更新内存索引
    this.entries.set(name, { name, description, filePath });

    return filePath;
  }

  /**
   * 更新已有 skill 的正文内容（保留 frontmatter）
   *
   * @throws 如果 skill 不存在
   */
  patch(name: string, content: string): void {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`Skill "${name}" 不存在，无法 patch`);
    }

    const raw = readFileSync(entry.filePath, 'utf-8');
    const parsed = parseSkillFile(raw, entry.filePath);

    // 保留原 frontmatter，替换正文
    const fileContent = this.buildSkillMd(parsed.meta.name, parsed.meta.description, content, parsed.meta.state);
    writeFileSync(entry.filePath, fileContent, 'utf-8');
  }

  /** 检查 skill 是否已索引 */
  has(name: string): boolean {
    return this.entries.has(name);
  }

  private validateName(name: string): void {
    if (!name || name.length === 0) {
      throw new Error('Skill name 不能为空');
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Skill name 超过 ${MAX_NAME_LENGTH} 字符限制`);
    }
    if (!SKILL_NAME_RE.test(name)) {
      throw new Error(`Skill name 格式无效（仅允许小写字母、数字、连字符）: "${name}"`);
    }
  }

  private buildSkillMd(name: string, description: string, content: string, state = 'active'): string {
    const lines = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
    ];
    if (state !== 'active') {
      lines.push(`state: ${state}`);
    }
    lines.push('---');
    lines.push(content);
    return lines.join('\n');
  }
}

// ─── 模块级单例（按数据根键化，租户隔离）────────────────────────────────

const skillIndexCache = new Map<string, SkillIndex>();

/** 获取 SkillIndex 单例（首次调用时扫描） */
export function getSkillIndex(): SkillIndex {
  const root = getDataRoot();
  if (!skillIndexCache.has(root)) {
    const instance = new SkillIndex(getDataPath('skills'));
    instance.scan();
    skillIndexCache.set(root, instance);
  }
  return skillIndexCache.get(root)!;
}

/** 重置单例（测试用） */
export function _resetSkillIndex(): void {
  skillIndexCache.clear();
}
