/**
 * worker 短命进程 secrets 注入（从 worker-runner 抽出，供多种 worker 复用：
 * 游荡 worker-runner + 微信回复 wechat-reply）。
 *
 * S4 store 解密 → 临时 JSON（0600，跑完即删）→ `--secrets-file` 注入；
 * 密钥只在磁盘上以密文（dek.enc/DB）和这段临时明文文件存在，进程退出即清。
 */

import { randomBytes } from 'crypto';
import { chmod, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TenantSecretsStore } from './tenant-secrets.js';

/** secrets store 名 → AgentSecrets 字段（S4 存储名约定） */
export const SECRET_FIELD_BY_NAME: Record<string, string> = {
  deepseek_api_key: 'deepseekApiKey',
  tavily_api_key: 'tavilyApiKey',
  exa_api_key: 'exaApiKey',
  feishu_webhook: 'feishuWebhook',
};

/** 解密租户 secrets → AgentSecrets 对象；无任何项返回 null */
export async function resolveAgentSecrets(
  open: (dataDir: string, tenantId: string) => Promise<TenantSecretsStore>,
  dataDir: string,
  tenantId: string,
): Promise<Record<string, string> | null> {
  const store = await open(dataDir, tenantId);
  const names = await store.list();
  const secrets: Record<string, string> = {};
  for (const name of names) {
    const field = SECRET_FIELD_BY_NAME[name];
    if (!field) continue;
    secrets[field] = (await store.get(name)) ?? '';
  }
  return Object.keys(secrets).length > 0 ? secrets : null;
}

/** 有 secrets → 写 0600 临时 JSON（跑完由调用方删）；无 → null */
export async function writeSecretsFile(
  open: (dataDir: string, tenantId: string) => Promise<TenantSecretsStore>,
  dataDir: string,
  tenantId: string,
): Promise<string | null> {
  const secrets = await resolveAgentSecrets(open, dataDir, tenantId);
  if (!secrets) return null;
  const path = join(tmpdir(), `cp-secrets-${tenantId}-${randomBytes(8).toString('hex')}.json`);
  await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
