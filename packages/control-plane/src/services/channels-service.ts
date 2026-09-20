/**
 * ChannelsService（应用层）——每租户推送通道绑定
 *
 * 默认通道 = PWA（Web Push，无需配置）；飞书可选，webhook 走信封加密
 * 存储（openTenantSecrets），worker-runner 解密注入 AgentSecrets——agent
 * 侧 speak() 消费既有配置字段，推送契约不变。只报有无，不回显凭证。
 */

import type { ControlPlaneConfig } from '../config.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';

/** secrets 存储名（worker-runner SECRET_FIELD_BY_NAME 同名约定） */
export const FEISHU_WEBHOOK_SECRET = 'feishu_webhook';

export interface ChannelsServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir'>;
}

export function createChannelsService({ config }: ChannelsServiceDeps) {
  /** 通道绑定状态（只报有无，不回显凭证） */
  async function getStatus(tenantId: string) {
    const store = await openTenantSecrets(config.dataDir, tenantId);
    const names = await store.list();
    return {
      feishu: names.includes(FEISHU_WEBHOOK_SECRET),
      webPush: 'default' as const,
    };
  }

  /** 绑定飞书 webhook（信封加密存储） */
  async function bindFeishu(tenantId: string, webhook: string) {
    const store = await openTenantSecrets(config.dataDir, tenantId);
    await store.set(FEISHU_WEBHOOK_SECRET, webhook);
    return { bound: true };
  }

  /** 解绑飞书 webhook */
  async function unbindFeishu(tenantId: string) {
    const store = await openTenantSecrets(config.dataDir, tenantId);
    const removed = await store.delete(FEISHU_WEBHOOK_SECRET);
    return { removed };
  }

  return { getStatus, bindFeishu, unbindFeishu };
}

export type ChannelsService = ReturnType<typeof createChannelsService>;
