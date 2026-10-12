/**
 * 邀请申请用例编排：公开提交（限流）→ admin 审批（批准 = 生成单人邀请并
 * 与申请绑定）→ 凭据对查询取链接。
 *
 * 无登录态的公开面，滥用控制靠两层：内存滑动窗限流（单进程部署现状，
 * 与 auth/state-store 同款妥协）+ 凭据对不可枚举（随机申请号/查询码）。
 */

import type { ControlPlaneConfig } from '../config.js';
import * as invitesRepo from '../infra/invites-repo.js';
import {
  createApplication,
  decideApplication,
  findApplicationByCredentials,
  findApplicationById,
  listApplications,
  type ApplicationRecord,
} from '../infra/applications-repo.js';

export interface InviteApplicationDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'webOrigin'>;
}

export type ApplicationOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 404 | 429; error: string };

/** 滑动窗限流器：key（如 ip）→ 窗口内时间戳；惰性清理防内存膨胀 */
function createSlidingWindowLimiter(windowMs: number, max: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10_000) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      }
    }
    return true;
  };
}

/** 提交：每 IP 每小时 5 次；查询：每 IP 每分钟 20 次（防凭据对爆破） */
const SUBMIT_LIMIT = { windowMs: 3_600_000, max: 5 };
const QUERY_LIMIT = { windowMs: 60_000, max: 20 };

export function createInviteApplicationService({ config }: InviteApplicationDeps) {
  const allowSubmit = createSlidingWindowLimiter(SUBMIT_LIMIT.windowMs, SUBMIT_LIMIT.max);
  const allowQuery = createSlidingWindowLimiter(QUERY_LIMIT.windowMs, QUERY_LIMIT.max);

  /** POST /api/apply：返回凭据对（查询码只此一次） */
  async function submit(input: {
    ip: string;
    nickname: string | null;
    reason: string;
  }): Promise<ApplicationOutcome<{ applicationId: string; secret: string }>> {
    if (!allowSubmit(input.ip)) {
      return { ok: false, status: 429, error: '申请太频繁了，一小时后再来试试' };
    }
    const { record, secret } = await createApplication(config.dataDir, {
      nickname: input.nickname,
      reason: input.reason,
    });
    return { ok: true, data: { applicationId: record.publicId, secret } };
  }

  /** GET /api/apply/status：凭据对查询；approved 附邀请链接 */
  async function query(publicId: string, secret: string, ip: string): Promise<
    ApplicationOutcome<{ status: string; inviteUrl?: string }>
  > {
    if (!allowQuery(ip)) {
      return { ok: false, status: 429, error: '查询太频繁了，稍后再试' };
    }
    const record = await findApplicationByCredentials(config.dataDir, publicId, secret);
    if (!record) return { ok: false, status: 404, error: '申请号或查询码不对' };
    return {
      ok: true,
      data: record.status === 'approved' && record.inviteUrl
        ? { status: record.status, inviteUrl: record.inviteUrl }
        : { status: record.status },
    };
  }

  /** admin：申请列表（新在前；secretHash 是凭据哈希，绝不离开 CP） */
  async function list(): Promise<Omit<ApplicationRecord, 'secretHash'>[]> {
    const rows = await listApplications(config.dataDir);
    return rows.map(({ secretHash: _secretHash, ...rest }) => rest);
  }

  /** admin 批准：生成单人邀请并绑定（复用既有 createInvite 边界） */
  async function approve(id: string, adminSub: string): Promise<ApplicationOutcome<ApplicationRecord>> {
    const pending = await findApplicationById(config.dataDir, id);
    if (!pending) return { ok: false, status: 404, error: '申请不存在' };
    if (pending.status !== 'pending') return { ok: false, status: 400, error: '该申请已处理过' };

    const invite = await invitesRepo.createInvite(config.dataDir, {
      createdBy: adminSub,
      label: `申请 ${pending.publicId}${pending.nickname ? ` · ${pending.nickname}` : ''}`,
      maxUses: 1,
    });
    const inviteUrl = `${config.webOrigin}/?invite=${invite.token}`;
    const record = await decideApplication(config.dataDir, id, {
      status: 'approved',
      decidedBy: adminSub,
      inviteId: invite.id,
      inviteUrl,
    });
    if (!record) return { ok: false, status: 400, error: '该申请已处理过' };
    return { ok: true, data: record };
  }

  /** admin 回绝 */
  async function reject(id: string, adminSub: string): Promise<ApplicationOutcome<ApplicationRecord>> {
    const record = await decideApplication(config.dataDir, id, { status: 'rejected', decidedBy: adminSub });
    if (!record) return { ok: false, status: 404, error: '申请不存在或已处理过' };
    return { ok: true, data: record };
  }

  return { submit, query, list, approve, reject };
}
