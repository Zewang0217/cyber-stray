/** CP 与 agent 视觉质检共用的模型端点选择，避免同一模型落到不同供应商。 */
export const DEFAULT_VISION_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const ECNU_VISION_BASE_URL = 'https://chat.ecnu.edu.cn/open/api/v1';

/** ecnu 系视觉模型必须使用 ECNU 网关。 */
export function resolveVisionBaseUrl(model: string): string {
  return model.startsWith('ecnu') ? ECNU_VISION_BASE_URL : DEFAULT_VISION_BASE_URL;
}
