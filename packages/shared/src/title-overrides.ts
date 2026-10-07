/** 当天历史仍在追加时，agent 写入、CP 只读的标题覆盖契约。 */
import { z } from 'zod';

export const TITLE_OVERRIDE_MAX_ENTRIES = 200;
export const IndependentTitleSchema = z.string().trim().min(4).max(24)
  .refine((value) => !/[\r\n]/.test(value), '标题必须为单行');

export const TitleOverrideEntrySchema = z.object({
  title: IndependentTitleSchema,
  sourceType: z.enum(['article', 'share']),
  oldTitle: z.string(),
  titleSourceAbsent: z.literal(true),
  timestamp: z.string().min(1),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const TitleOverridesSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.uuid(), TitleOverrideEntrySchema)
    .refine((entries) => Object.keys(entries).length <= TITLE_OVERRIDE_MAX_ENTRIES,
      `标题覆盖最多 ${TITLE_OVERRIDE_MAX_ENTRIES} 条`),
});

export type TitleOverrides = z.infer<typeof TitleOverridesSchema>;
