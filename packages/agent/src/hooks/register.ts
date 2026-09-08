/**
 * Hook 静态注册表
 *
 * 对齐 tools/registry/auto-register.ts 的静态数组模式。
 * 目录扫描方案（readdir + dynamic import）在编译部署后只扫到 .js，
 * 导致 0 个 hook 加载、安全/质量/去重守卫静默消失——已废弃。
 */

import { dedupHook } from './dedup.js';
import { qualityHook } from './quality.js';
import { securityHook } from './security.js';
import type { HookDefinition } from './types.js';

/**
 * 所有 hook 定义（按语义分组，运行时按 priority 排序）。
 * budget hook 已删（ADR-0013 #216：「energy<20 禁 read_page」语义倒挂——
 * 精力收窄为游荡燃料，防滥用由步数上限 + 日预算 + prompt 注入自控承担）
 */
const HOOK_DEFINITIONS: HookDefinition[] = [
  securityHook,
  dedupHook,
  qualityHook,
];

export { HOOK_DEFINITIONS };
