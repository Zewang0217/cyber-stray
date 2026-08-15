/**
 * 每租户 secrets 信封加密（S4，#71）
 *
 * 信封结构：
 * - MK（master key，env/文件）→ 包裹每租户 DEK → 存 `tenants/<id>/secrets/dek.enc`
 * - DEK（每租户 32 字节随机）→ 加密整个 envelope（name→value JSON，含键名）
 *   → 密文存 DB `tenant_secrets.encrypted`（无明文落盘，含元数据）
 *
 * 安全属性：
 * - DEK 独立：删 DEK = 遗忘租户（永久不可解，无跨租户 blast radius）
 * - AAD = tenantId：DB 行/DEK 文件被搬到别的租户名下时 GCM tag 校验失败
 * - DEK 不缓存：每次操作重读文件（froze 后任何存活实例立即可见遗忘）
 * - 半遗忘态显式报错：envelope 非空但 DEK 缺失 = 数据已毁，抛错要求先 forget，
 *   绝不静默重建（否则新旧 DEK 密文混入同一 envelope，旧值永久不可解）
 *
 * 并发安全（单进程控制面）：
 * - DEK 创建用 flag 'wx'（exclusive）：并发首建只有一个成功，其余读回既有
 * - envelope 读-改-写经租户级互斥锁串行化，无丢更新
 *
 * 统一存取接口（供 worker / 推送网关）：get/set/delete/list/forget。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, type ControlDb } from '../db/client.js';
import { tenantSecrets as tenantSecretsTable } from '../db/schema.js';
import { loadMasterKey } from './master-key.js';

const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;
const DEK_LEN = 32;

const DEK_FILE = 'dek.enc';

/** 信封：name → value（整体 DEK 加密后存 DB） */
type Envelope = Record<string, string>;

/** 统一存取接口（供 worker / 推送网关使用） */
export interface TenantSecretsStore {
  /** 解密读取；不存在返回 null。DEK 缺失但密文存在（半遗忘态）抛错 */
  get(name: string): Promise<string | null>;
  /** 加密写入（覆盖同名）。半遗忘态抛错，须先 forget 再重配 */
  set(name: string, value: string): Promise<void>;
  /** 删除单个 secret；不存在返回 false */
  delete(name: string): Promise<boolean>;
  /** 列出全部 name */
  list(): Promise<string[]>;
  /** 删除 DB 行 + DEK 文件 = 遗忘租户（永久不可解） */
  forget(): Promise<void>;
}

/** AES-256-GCM 加密：base64(nonce || tag || ciphertext) */
function encryptWith(key: Buffer, plaintext: string, aad: Buffer): string {
  const nonce = randomBytes(GCM_IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ct]).toString('base64');
}

/** AES-256-GCM 解密（tag 校验失败抛错：密钥不符/数据被篡改/跨租户搬移） */
function decryptWith(key: Buffer, packed: string, aad: Buffer): string {
  const buf = Buffer.from(packed, 'base64');
  if (buf.length < GCM_IV_LEN + GCM_TAG_LEN) {
    throw new Error('secrets 密文格式非法');
  }
  const nonce = buf.subarray(0, GCM_IV_LEN);
  const tag = buf.subarray(GCM_IV_LEN, GCM_IV_LEN + GCM_TAG_LEN);
  const ct = buf.subarray(GCM_IV_LEN + GCM_TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new Error('secrets 解密失败：DEK 不匹配或数据被篡改', { cause: error });
  }
}

/** 半遗忘态错误：envelope 有密文但 DEK 文件缺失 */
class MissingDekError extends Error {
  constructor(tenantId: string) {
    super(
      `租户 ${tenantId} 的 DEK 文件缺失但密文仍存在（半遗忘态）：` +
        '请先 forget() 再重新配置 secrets；不静默重建以避免新旧密文混用',
    );
    this.name = 'MissingDekError';
  }
}

/** 租户级互斥（单进程内串行化读-改-写，防 envelope 丢更新） */
const tenantLocks = new Map<string, Promise<unknown>>();

function withTenantLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tenantLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // 保持链不断（吞错只影响链本身，错误经 run 传播给调用者）
  tenantLocks.set(key, run.catch(() => undefined));
  return run;
}

/** tenantId 只允许字母数字短横（uuid 及测试名），排除路径分隔符与 `.`（防注入） */
const TENANT_ID_RE = /^[a-zA-Z0-9-]{1,64}$/;

class TenantSecrets implements TenantSecretsStore {
  constructor(
    private readonly dataDir: string,
    private readonly tenantId: string,
    private readonly masterKey: Buffer,
    private readonly db: ControlDb,
  ) {}

  /** AAD = tenantId：防 envelope 行/DEK 文件跨租户搬移 */
  private aad(): Buffer {
    return Buffer.from(this.tenantId, 'utf8');
  }

  private secretsDir(): string {
    return join(this.dataDir, 'tenants', this.tenantId, 'secrets');
  }

  private dekPath(): string {
    return join(this.secretsDir(), DEK_FILE);
  }

  /**
   * 读 DEK 文件并解密。文件缺失返回 null（不自动生成——
   * 生成只发生在 set 且 envelope 为空的全新配置路径）。
   */
  private async readDek(): Promise<Buffer | null> {
    let packed: string;
    try {
      packed = await readFile(this.dekPath(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const dek = Buffer.from(decryptWith(this.masterKey, packed, this.aad()), 'base64');
    if (dek.length !== DEK_LEN) {
      throw new Error('DEK 解出长度非法（可能 MK 与 DEK 版本不符）');
    }
    return dek;
  }

  /**
   * 生成并原子落盘新 DEK（flag 'wx'：并发首建只有一个成功，其余读回既有）。
   */
  private async createDek(): Promise<Buffer> {
    await mkdir(this.secretsDir(), { recursive: true });
    const dek = randomBytes(DEK_LEN);
    const packed = encryptWith(this.masterKey, dek.toString('base64'), this.aad());
    try {
      await writeFile(this.dekPath(), packed, { mode: 0o600, flag: 'wx' });
      return dek;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // 并发实例已建；读回既有 DEK（一致性优先）
        const existing = await this.readDek();
        if (existing) return existing;
      }
      throw error;
    }
  }

  /** 读 DB 密文行；无则 null */
  private async loadRow() {
    return this.db
      .select()
      .from(tenantSecretsTable)
      .where(eq(tenantSecretsTable.tenantId, this.tenantId))
      .get();
  }

  /**
   * 解出 envelope。返回 [envelope, 有密文?]：
   * - 无行：空 envelope，无密文（无需 DEK）
   * - 有行 + DEK 缺失：抛 MissingDekError（半遗忘态，不静默重建）
   */
  private async loadEnvelope(): Promise<Envelope> {
    const row = await this.loadRow();
    if (!row?.encrypted) return {};
    const dek = await this.readDek();
    if (!dek) throw new MissingDekError(this.tenantId);
    return JSON.parse(decryptWith(dek, row.encrypted, this.aad())) as Envelope;
  }

  /** 整包加密写回（含键名，无明文落盘） */
  private async saveEnvelope(envelope: Envelope): Promise<void> {
    const dek = await this.readDek();
    if (!dek) throw new MissingDekError(this.tenantId);
    const encrypted = encryptWith(dek, JSON.stringify(envelope), this.aad());
    await this.db
      .insert(tenantSecretsTable)
      .values({ tenantId: this.tenantId, encrypted })
      .onConflictDoUpdate({
        target: tenantSecretsTable.tenantId,
        set: { encrypted },
      })
      .run();
  }

  get(name: string): Promise<string | null> {
    return withTenantLock(this.lockKey(), async () => {
      const envelope = await this.loadEnvelope();
      const value = envelope[name];
      return value ?? null;
    });
  }

  set(name: string, value: string): Promise<void> {
    return withTenantLock(this.lockKey(), async () => {
      // 半遗忘态（有密文无 DEK）：抛错要求先 forget 再重配
      const row = await this.loadRow();
      if (row?.encrypted && !(await this.readDek())) {
        throw new MissingDekError(this.tenantId);
      }
      if (!(await this.readDek())) {
        await this.createDek(); // 全新配置：首次生成
      }
      const envelope = await this.loadEnvelope();
      envelope[name] = value;
      await this.saveEnvelope(envelope);
    });
  }

  delete(name: string): Promise<boolean> {
    return withTenantLock(this.lockKey(), async () => {
      const envelope = await this.loadEnvelope();
      if (!(name in envelope)) return false;
      delete envelope[name];
      if (Object.keys(envelope).length === 0) {
        // 清空：删行（不留空 envelope）
        await this.db
          .delete(tenantSecretsTable)
          .where(eq(tenantSecretsTable.tenantId, this.tenantId))
          .run();
      } else {
        await this.saveEnvelope(envelope);
      }
      return true;
    });
  }

  list(): Promise<string[]> {
    return withTenantLock(this.lockKey(), async () => {
      const envelope = await this.loadEnvelope();
      return Object.keys(envelope);
    });
  }

  forget(): Promise<void> {
    return withTenantLock(this.lockKey(), async () => {
      // 先删行后删文件：行删失败可重试自愈；文件删了行还在 = 半遗忘态显式报错
      await this.db
        .delete(tenantSecretsTable)
        .where(eq(tenantSecretsTable.tenantId, this.tenantId))
        .run();
      await rm(this.dekPath(), { force: true });
    });
  }

  private lockKey(): string {
    return `${this.dataDir}\u0000${this.tenantId}`;
  }
}

/** 打开某租户的 secrets 存取器（无副作用，直到首次读写） */
export async function openTenantSecrets(
  dataDir: string,
  tenantId: string,
): Promise<TenantSecretsStore> {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`非法 tenantId：${tenantId}（仅允许 uuid 形态）`);
  }
  const masterKey = await loadMasterKey(dataDir);
  const db = await getDb(dataDir);
  return new TenantSecrets(dataDir, tenantId, masterKey, db);
}
