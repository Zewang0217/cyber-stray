/**
 * Security Hook — 安全护栏（骨架）
 *
 * Wave 1 仅占位。后续实现：
 * - UNTRUSTED 标记注入（#49）
 * - 域名白名单（#53）
 * - 输出内容安全扫描
 */

import type { HookDefinition } from './types.js';

export default {
  name: 'security',
  priority: 1,
  // 暂无拦截逻辑，后续 issue 实现
} satisfies HookDefinition;
