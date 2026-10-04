/** Worker 无法完整记录已发生的用量；CP 必须停派发并要求运维修复账本。 */
export const USAGE_ACCOUNTING_FAILURE_EXIT_CODE = 3;

/** 游荡已完成并回报数值，但后续反思失败；CP 保留交付并明确发布反思故障。 */
export const REFLECTION_FAILURE_EXIT_CODE = 4;
