import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthRoutes } from './auth.js';
import { StateStore } from '../auth/state-store.js';
import { loadConfig } from '../config.js';

vi.mock('../infra/tenant-access.js', () => ({
  findUserTenantRelation: vi.fn(async () => ({})),
  findTenantById: vi.fn(async () => ({ deletedAt: null })),
}));
vi.mock('../infra/tenant.js', () => ({ getOrCreateTenant: vi.fn() }));
vi.mock('../infra/invites-repo.js', () => ({ validateInvite: vi.fn(), consumeInvite: vi.fn() }));

function loginFixture() {
  const oidc = {
    buildAuthUrl: vi.fn(async () => ({ url: 'https://id.example/?state=random-state', state: 'random-state', nonce: 'nonce', verifier: 'verifier' })),
    handleCallback: vi.fn(async () => ({ sub: 'alice' })),
  };
  const config = loadConfig({ CP_SESSION_SECRET: 'test-012345678901234567890123456789', CP_WEB_ORIGIN: 'https://app.example' });
  return { oidc, app: createAuthRoutes({ config, oidc, states: new StateStore() }) };
}

afterEach(() => vi.useRealTimers());

describe('OIDC 浏览器绑定（不连接数据库）', () => {
  it('其他浏览器仅持有回调 URL 时拒绝，原浏览器仍能完成且不能重放', async () => {
    const { app, oidc } = loginFixture();
    const login = await app.request('/login');
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    expect(login.headers.get('set-cookie')).toContain('__Host-cs_oidc_state=');
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('Secure');
    expect(login.headers.get('set-cookie')).toContain('Max-Age=600');
    const callback = '/callback?code=code&state=random-state';
    const stolen = await app.request(callback);
    expect(stolen.headers.get('location')).toContain('state_invalid');
    expect(oidc.handleCallback).not.toHaveBeenCalled();
    const wrongCookie = await app.request(callback, { headers: { cookie: '__Host-cs_oidc_state=another-browser-state' } });
    expect(wrongCookie.headers.get('location')).toContain('state_invalid');
    expect(cookie).toBeTruthy();
    const legitimate = await app.request(callback, { headers: { cookie: cookie! } });
    expect(legitimate.headers.get('location')).toBe('https://app.example');
    expect(oidc.handleCallback).toHaveBeenCalledOnce();
    const replay = await app.request(callback, { headers: { cookie: cookie! } });
    expect(replay.headers.get('location')).toContain('state_invalid');
    expect(oidc.handleCallback).toHaveBeenCalledOnce();
  });

  it('即使浏览器携带匹配 cookie，过期 state 也不能完成认证', async () => {
    vi.useFakeTimers();
    const { app, oidc } = loginFixture();
    const login = await app.request('/login');
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const callback = await app.request('/callback?code=code&state=random-state', { headers: { cookie } });
    expect(callback.headers.get('location')).toContain('state_invalid');
    expect(oidc.handleCallback).not.toHaveBeenCalled();
  });
});
