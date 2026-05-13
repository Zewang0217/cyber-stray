/**
 * 工具注册兼容层
 *
 * 向后兼容：保留原有 createTools(ctx) 接口
 * 新代码建议直接使用 ToolManager
 */

import type { Tool } from 'ai';
import { ToolManager } from '../tool-manager.js';
import type { ToolContext } from './context.js';

// 重新导出 ToolManager 和类型
export { ToolManager } from '../tool-manager.js';
export type { ToolMetadata, ToolDefinition, ToolStats } from '../tool-manager.js';
export type { ToolContext } from './context.js';

/**
 * 向后兼容：根据上下文创建所有 Tools
 *
 * @deprecated 建议使用 ToolManager.getTools(ctx)
 */
export function createTools(ctx: ToolContext): Record<string, Tool> {
  return ToolManager.getTools(ctx);
}