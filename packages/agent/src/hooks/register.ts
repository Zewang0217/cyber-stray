/**
 * Hook 静态注册表
 *
 * 对齐 tools/registry/auto-register.ts 的静态数组模式。
 * 目录扫描方案（readdir + dynamic import）在编译部署后只扫到 .js，
 * 导致 0 个 hook 加载、安全/质量/去重守卫静默消失——已废弃。
 */

import { budgetHook } from './budget.js';
import { dedupHook } from './dedup.js';
import { qualityHook } from './quality.js';
import { securityHook } from './security.js';
import type { HookDefinition } from './types.js';

/** 所有 hook 定义（按语义分组，运行时按 priority 排序） */
const HOOK_DEFINITIONS: HookDefinition[] = [
  securityHook,
  budgetHook,
  dedupHook,
  qualityHook,
];

export { HOOK_DEFINITIONS };
