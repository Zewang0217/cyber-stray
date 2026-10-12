/**
 * 邀请申请契约（公开申请通道）：不收集邮箱等隐私——申请人当场领
 * 「申请号 + 查询码」凭据对，凭据对即取回凭据（approved 后换邀请链接）。
 *
 * 消费方：CP routes（/api/apply、/api/admin/applications）、web /apply 页
 * 与 admin 面板。字段单一真相源在此，呈现层只格式化。
 */

import { z } from 'zod';

/** 查询码随机字节数（hex 后 32 位，与邀请 token 同强度） */
export const APPLICATION_SECRET_BYTES = 16;
/** 申请号随机字节数（hex 后 12 位；非自增，防枚举） */
export const APPLICATION_PUBLIC_ID_BYTES = 6;

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export const ApplicationStatusSchema = z.enum(['pending', 'approved', 'rejected']);

/** POST /api/apply 请求体：昵称可选，理由必填（防空灌水有最小长度） */
export const ApplyRequestSchema = z.object({
  nickname: z.string().trim().max(32).optional(),
  reason: z.string().trim().min(8).max(500),
});
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

/** POST /api/apply 响应：查询码只此一次返回（服务端只存 sha256） */
export const ApplyResponseSchema = z.object({
  applicationId: z.string().regex(/^[0-9a-f]{12}$/),
  secret: z.string().regex(/^[0-9a-f]{32}$/),
});
export type ApplyResponse = z.infer<typeof ApplyResponseSchema>;

/** GET /api/apply/status 响应：approved 时附邀请链接（凭据对即取回凭据） */
export const ApplicationStatusResponseSchema = z.object({
  status: ApplicationStatusSchema,
  inviteUrl: z.string().optional(),
});
export type ApplicationStatusResponse = z.infer<typeof ApplicationStatusResponseSchema>;

/** admin 列表项（GET /api/admin/applications）；approved 附已生成的邀请链接 */
export const AdminApplicationSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  nickname: z.string().nullable(),
  reason: z.string(),
  status: ApplicationStatusSchema,
  createdAt: z.number(),
  decidedAt: z.number().nullable(),
  inviteUrl: z.string().nullable(),
});
export type AdminApplication = z.infer<typeof AdminApplicationSchema>;

export function isApplicationId(raw: string | null | undefined): raw is string {
  return typeof raw === 'string' && /^[0-9a-f]{12}$/.test(raw);
}

export function isApplicationSecret(raw: string | null | undefined): raw is string {
  return typeof raw === 'string' && /^[0-9a-f]{32}$/.test(raw);
}

/** 状态文案（web 呈现层共用，禁多处平行定义） */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: '待审',
  approved: '已批准',
  rejected: '已回绝',
};
