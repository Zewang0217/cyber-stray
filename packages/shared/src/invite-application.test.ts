import { describe, test, expect } from 'vitest';
import {
  ApplyRequestSchema,
  ApplyResponseSchema,
  isApplicationId,
  isApplicationSecret,
} from './invite-application';

describe('邀请申请契约', () => {
  test('申请体：理由 8-500 字必填，昵称可选 ≤32 字（trim 后校验）', () => {
    expect(ApplyRequestSchema.safeParse({ reason: '我想看它探索像素画和复古掌机的世界' }).success).toBe(true);
    expect(ApplyRequestSchema.safeParse({ nickname: '  昃往  ', reason: '想要一只会自己冲浪的猫' }).data?.nickname).toBe('昃往');
    expect(ApplyRequestSchema.safeParse({ reason: '太短' }).success).toBe(false);
    expect(ApplyRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(ApplyRequestSchema.safeParse({ nickname: 'x'.repeat(33), reason: '理由长度足够八个字' }).success).toBe(false);
    expect(ApplyRequestSchema.safeParse({}).success).toBe(false);
  });

  test('凭据对格式：申请号 12 位 hex，查询码 32 位 hex', () => {
    expect(ApplyResponseSchema.safeParse({
      applicationId: 'a1b2c3d4e5f6',
      secret: 'a'.repeat(32),
    }).success).toBe(true);
    expect(isApplicationId('a1b2c3d4e5f6')).toBe(true);
    expect(isApplicationId('A1B2C3D4E5F6')).toBe(false); // 大写不算
    expect(isApplicationId('short')).toBe(false);
    expect(isApplicationSecret('b'.repeat(32))).toBe(true);
    expect(isApplicationSecret('b'.repeat(31))).toBe(false);
    expect(isApplicationSecret(null)).toBe(false);
  });
});
