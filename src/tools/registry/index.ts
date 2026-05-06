import type { ToolContext } from './context.js';
import { createSearchWebTool } from './search-web.js';
import { createReadPageTool } from './read-page.js';
import { createSpeakTool } from './speak.js';
import { createRestTool } from './rest.js';
import { createRecordKnowledgeTool } from './record-knowledge.js';
import { createObserveUserTool } from './observe-user.js';
import { createReadFeedbackTool, createProcessFeedbackTool } from './read-feedback.js';

export type { ToolContext };

/** 根据上下文创建所有 Tools（返回 AI SDK ToolSet） */
export function createTools(ctx: ToolContext) {
  return {
    search_web: createSearchWebTool(ctx),
    read_page: createReadPageTool(ctx),
    speak: createSpeakTool(ctx),
    rest: createRestTool(ctx),
    record_knowledge: createRecordKnowledgeTool(ctx),
    observe_user: createObserveUserTool(ctx),
    // 反馈相关
    read_feedback: createReadFeedbackTool(ctx),
    process_feedback: createProcessFeedbackTool(ctx),
  };
}
