/**
 * 工具统一注册入口
 *
 * 约定：所有工具定义在此处注册
 * 添加新工具时：
 * 1. 在对应工具文件中导出 ToolDefinition
 * 2. 在此文件 import 并添加到 TOOL_DEFINITIONS 数组
 */

import { ToolManager } from '../tool-manager.js';
import { searchWebToolDef } from './search-web.js';
import { readPageToolDef } from './read-page.js';
import { speakToolDef } from './speak.js';
import { restToolDef } from './rest.js';
import { recordKnowledgeToolDef } from './record-knowledge.js';
import { observeUserToolDef } from './observe-user.js';
import { readFeedbackToolDef, processFeedbackToolDef } from './read-feedback.js';

/** 所有工具定义列表 */
const TOOL_DEFINITIONS = [
  searchWebToolDef,
  readPageToolDef,
  speakToolDef,
  restToolDef,
  recordKnowledgeToolDef,
  observeUserToolDef,
  readFeedbackToolDef,
  processFeedbackToolDef,
];

/**
 * 注册所有工具到 ToolManager
 * Agent 启动时调用此函数
 */
export async function registerAllTools(): Promise<void> {
  ToolManager.batchRegister(TOOL_DEFINITIONS);
}