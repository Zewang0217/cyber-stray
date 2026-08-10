/**
 * Hook 加载器
 *
 * 静态注册（对齐 tools/registry/auto-register.ts）：从 register.ts 的
 * HOOK_DEFINITIONS 数组加载，按 priority 升序排列。
 *
 * 为什么不用目录扫描：编译部署后目录里只有 .js，动态 import 扫描会加载 0 个
 * hook，PushGate/cooldown/精力守卫静默消失（实测证实）。静态注册在编译期
 * 即可发现缺失，无运行时失效风险。
 */

import { consola } from '../logger.js';
import { HOOK_DEFINITIONS } from './register.js';
import type { HookDefinition } from './types.js';

const logger = consola.withTag('hooks:loader');

/**
 * 加载所有 HookDefinition。
 *
 * @param disabledNames - 需要禁用的 hook 名称列表（来自 agent-config.json 的 hooks.disabled）
 * @returns 按 priority 升序排列的 hook 数组
 * @throws 当没有任何可用 hook 时抛错（fail-fast，防止守卫静默全灭）
 */
export function loadHooks(disabledNames?: string[]): HookDefinition[] {
  const disabled = new Set(disabledNames ?? []);
  const active = HOOK_DEFINITIONS
    .filter((h) => !disabled.has(h.name))
    .sort((a, b) => a.priority - b.priority);

  if (active.length === 0) {
    throw new Error(
      `没有可用的 hook（共 ${HOOK_DEFINITIONS.length} 个，全部被禁用？）——安全/质量/去重守卫不能静默缺失`,
    );
  }

  logger.info(`Hook 加载完成`, {
    total: HOOK_DEFINITIONS.length,
    active: active.length,
    disabled: HOOK_DEFINITIONS.length - active.length,
    order: active.map((h) => h.name),
  });

  return active;
}
