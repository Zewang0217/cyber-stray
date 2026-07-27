/**
 * 工具统一注册入口
 *
 * 约定：所有工具定义在此处注册
 * 添加新工具时：
 * 1. 在对应工具文件中导出 ToolDefinition
 * 2. 在此文件 import 并添加到 TOOL_DEFINITIONS 数组
 */

import { ToolManager } from '../tool-manager.js';
import { config } from '../../config.js';
import { searchWebToolDef } from './search-web.js';
import { readPageToolDef } from './read-page.js';
import { speakToolDef } from './speak.js';
import { restToolDef } from './rest.js';
import { recordKnowledgeToolDef } from './record-knowledge.js';
import { observeUserToolDef } from './observe-user.js';
import { readFeedbackToolDef, processFeedbackToolDef } from './read-feedback.js';
import { browserSkillListToolDef } from '../browser/skills/tool-list.js';
import { browserSkillLoadToolDef } from '../browser/skills/tool-load.js';
import { browserSkillCreateToolDef } from '../browser/skills/tool-create.js';
import { browsePageToolDef } from '../browser/tools/browse-page.js';
import { browseSnapshotToolDef } from '../browser/tools/browse-snapshot.js';
import { browseActToolDef } from '../browser/tools/browse-act.js';

/** 浏览器探索工具（browser.enabled = false 时不注册，design.md §3.5 / §6） */
const BROWSER_TOOL_DEFINITIONS = [
  browserSkillListToolDef,
  browserSkillLoadToolDef,
  browserSkillCreateToolDef,
  browsePageToolDef,
  browseSnapshotToolDef,
  browseActToolDef,
];

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
  ...(config.browser?.enabled !== false ? BROWSER_TOOL_DEFINITIONS : []),
];

/**
 * 注册所有工具到 ToolManager
 * Agent 启动时调用此函数
 */
export async function registerAllTools(): Promise<void> {
  ToolManager.batchRegister(TOOL_DEFINITIONS);
}