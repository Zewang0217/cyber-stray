/**
 * Hook 加载器：目录扫描自动发现
 *
 * 扫描 hooks/ 目录下所有 .ts 文件（排除基础设施文件），
 * 加载 export default 的 HookDefinition，按 priority 升序排列。
 * 配置文件可通过 disabledNames 禁用特定 hook。
 */

import { readdirSync } from 'node:fs';
import { consola } from '../logger.js';
import type { HookDefinition } from './types.js';

const logger = consola.withTag('hooks:loader');

/** 基础设施文件，不作为 hook 加载 */
const INFRA_FILES = new Set(['types.ts', 'loader.ts', 'chain.ts', 'index.ts']);

/**
 * 扫描 hooks/ 目录，加载所有 HookDefinition。
 *
 * @param disabledNames - 需要禁用的 hook 名称列表（来自 agent-config.json）
 * @returns 按 priority 升序排列的 hook 数组
 */
export async function loadHooks(disabledNames?: string[]): Promise<HookDefinition[]> {
  const dir = new URL('.', import.meta.url);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !INFRA_FILES.has(f),
  );

  const hooks: HookDefinition[] = [];

  for (const file of files) {
    try {
      const mod = await import(`./${file}`);
      const def: HookDefinition | undefined = mod.default;
      if (def?.name && typeof def.priority === 'number') {
        hooks.push(def);
      }
    } catch (error) {
      logger.warn(`加载 hook 文件失败: ${file}`, { error: String(error) });
    }
  }

  const disabled = new Set(disabledNames ?? []);
  const active = hooks
    .filter((h) => !disabled.has(h.name))
    .sort((a, b) => a.priority - b.priority);

  logger.info(`Hook 加载完成`, {
    total: hooks.length,
    active: active.length,
    disabled: hooks.length - active.length,
    order: active.map((h) => h.name),
  });

  return active;
}
