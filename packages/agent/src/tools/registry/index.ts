/**
 * 工具注册入口
 *
 * 重新导出 ToolManager 与相关类型。
 * 工具注册请在 registry/auto-register.ts 的 TOOL_DEFINITIONS 中完成。
 */

export { ToolManager } from '../tool-manager.js';
export type { ToolMetadata, ToolDefinition, ToolStats } from '../tool-manager.js';
export type { ToolContext } from './context.js';
