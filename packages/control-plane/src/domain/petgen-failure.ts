import type { PetGenTaskStatus } from '@cyber-stray/shared/petgen';

const QC_INFRA_PREFIX = '视觉质检连续异常（';
const QC_INFRA_SUFFIX = '）——质检服务暂不可用，请稍后重试';

/** Persist a distinct infrastructure failure so retries never bypass content verdicts. */
export function qcInfraFailureMessage(message: string): string {
  return `${QC_INFRA_PREFIX}${message}${QC_INFRA_SUFFIX}`;
}

/** Only the processor's infrastructure failure permits rechecking existing assets. */
export function canRetryPetGenQc(task: { status: PetGenTaskStatus; error: string | null }): boolean {
  return task.status === 'failed' && task.error !== null &&
    task.error.startsWith(QC_INFRA_PREFIX) && task.error.endsWith(QC_INFRA_SUFFIX);
}
