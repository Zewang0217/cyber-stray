/**
 * 工具 Prompt 描述生成器
 *
 * 从 ToolManager 获取工具元信息，生成格式化的工具说明
 */

import { ToolManager } from './tool-manager.js';

/** 分类显示名称 */
const CATEGORY_NAMES: Record<string, string> = {
  search: '搜索',
  web: '网页浏览',
  content: '内容创作',
  memory: '记忆管理',
  feedback: '反馈处理',
  browser: '浏览器操作',
  other: '其他',
};

/** 分类顺序 */
const CATEGORY_ORDER = ['search', 'web', 'browser', 'content', 'memory', 'feedback'];

/**
 * 生成工具描述 Markdown
 */
export function buildToolsDescription(): string {
  const tools = ToolManager.getMetadata();
  if (tools.length === 0) {
    return '（暂无可用工具）';
  }

  // 按分类分组
  const byCategory = new Map<string, typeof tools>();
  for (const tool of tools) {
    const cat = tool.category ?? 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(tool);
  }

  const sections: string[] = [];

  // 按顺序输出
  for (const cat of CATEGORY_ORDER) {
    const catTools = byCategory.get(cat);
    if (!catTools?.length) continue;

    sections.push(`**${CATEGORY_NAMES[cat] ?? cat}：**`);
    for (const t of catTools) {
      if (t.enabled === false) continue;

      // 格式化 description
      const desc = t.description
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');

      sections.push(`- \`${t.name}\` — ${desc}`);
    }
    sections.push('');
  }

  // 其他分类
  for (const [cat, catTools] of byCategory) {
    if (CATEGORY_ORDER.includes(cat)) continue;

    sections.push(`**${CATEGORY_NAMES[cat] ?? cat}：**`);
    for (const t of catTools) {
      if (t.enabled === false) continue;
      sections.push(`- \`${t.name}\` — ${t.description.split('\n')[0]?.trim() ?? ''}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * 生成简短工具列表（用于调试或日志）
 */
export function buildToolsSummary(): string {
  const tools = ToolManager.getMetadata();
  const enabled = tools.filter((t) => t.enabled);
  const names = enabled.map((t) => t.name).join(', ');
  return `${enabled.length}/${tools.length} tools: ${names || '(none)'}`;
}