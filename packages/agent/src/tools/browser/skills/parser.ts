/**
 * SKILL.md 解析器
 *
 * 解析 YAML frontmatter + Markdown 正文。
 * 不引入 yaml 依赖，使用简单正则解析（frontmatter 字段均为简单 key: value）。
 */

/** Skill 元信息 */
export interface SkillMeta {
  name: string;
  description: string;
  state: 'active' | 'stale' | 'archived';
}

/** 解析后的 Skill 文件 */
export interface ParsedSkill {
  meta: SkillMeta;
  /** Markdown 正文（frontmatter 之后的内容） */
  content: string;
  filePath: string;
}

const VALID_STATES = new Set(['active', 'stale', 'archived']);

/**
 * 解析 SKILL.md 原始内容
 *
 * @param raw - 文件原始文本
 * @param filePath - 文件路径（用于错误信息和返回值）
 * @throws Error 如果 frontmatter 格式无效或缺少必填字段
 */
export function parseSkillFile(raw: string, filePath: string): ParsedSkill {
  // frontmatter 必须以 --- 开头
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error(`[${filePath}] 缺少 YAML frontmatter（文件需以 --- 开头并以 --- 结束）`);
  }

  const frontmatter = match[1]!;
  const content = raw.slice(match[0].length).replace(/^\r?\n/, '');

  // 逐行解析 key: value
  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      fields.set(kv[1]!, kv[2]!.trim());
    }
  }

  const name = fields.get('name');
  if (!name) {
    throw new Error(`[${filePath}] frontmatter 缺少必填字段 name`);
  }

  const description = fields.get('description');
  if (!description) {
    throw new Error(`[${filePath}] frontmatter 缺少必填字段 description`);
  }

  const rawState = fields.get('state') ?? 'active';
  const state = VALID_STATES.has(rawState) ? rawState as SkillMeta['state'] : 'active';

  return {
    meta: { name, description, state },
    content,
    filePath,
  };
}
