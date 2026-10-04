import { getConfig, getTenantId } from '../../config.js';

/** 域名 allowlist 不等于网络隔离：CLI 尚无可验证的 DNS pinning 出站契约。 */
export const TENANT_BROWSER_DISABLED_REASON =
  '租户浏览器已停用：尚未部署阻止私网访问和 DNS 重绑定的浏览器网络隔离；请使用受保护的 read_page 阅读公开网页。';

/** 租户浏览器必须在网络沙箱验证完成后才可开放，配置开关不能绕过。 */
export function isBrowserAllowed(): boolean {
  return getTenantId() === null && getConfig().browser?.enabled !== false;
}
