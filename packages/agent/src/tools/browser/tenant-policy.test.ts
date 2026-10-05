import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig, setTenantContext } from '../../config.js';
import { getBrowserExecutor, _resetBrowserExecutor } from './executor.js';
import { ToolManager } from '../tool-manager.js';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

afterEach(() => { setTenantContext(null); _resetBrowserExecutor(); vi.clearAllMocks(); });

describe('SaaS 浏览器出站隔离', () => {
  it('未有网络隔离的租户无法启动浏览器，即使配置 enabled=true', async () => {
    const config = getConfig();
    setTenantContext({ tenantId: 'tenant-a', dataDir: '/tmp/browser-policy-a', config });
    await expect(getBrowserExecutor().execute('open', ['https://example.org'])).rejects.toThrow('租户浏览器已停用');
    expect(spawn).not.toHaveBeenCalled();
    await ToolManager.initialize();
    expect(ToolManager.getMetadata().some((tool) => tool.category === 'browser')).toBe(false);
  });
});
