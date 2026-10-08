/**
 * 登录墙（proxy 中间件 + matcher）测试
 *
 * P0 回归锚：/need-invite 必须豁免登录墙。CP 邀请门（#301）在邀请校验失败
 * 时 302 到 /need-invite，且此时尚未签发 session cookie（setCookie 在校验
 * 通过之后）。若登录墙拦截此页，无邀请的新用户会陷入
 * need-invite → login → callback → need-invite 的重定向死循环。
 *
 * 注意 matcher 是 Next 运行时按 config.matcher 决定是否调用的，直接调
 * proxy() 不会经过它——公开页豁免须对 matcher 正则本身断言。
 */

import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@cyber-stray/shared/session';
import { config, proxy } from './proxy';

function req(path: string, opts: { cookie?: string } = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  });
}

/** matcher 的等效正则（Next 以 path-to-regexp 编译；直接调 proxy 不经过它） */
function matcherRe(): RegExp {
  const [pattern] = config.matcher;
  if (!pattern?.startsWith('/')) {
    throw new Error(`matcher 非路径正则形态: ${JSON.stringify(config.matcher)}`);
  }
  return new RegExp(`^${pattern}`);
}

describe('proxy 登录墙（函数体：cookie 判定 + 素材直通）', () => {
  it('街景静态图片可匿名读取，相邻非素材路径仍受登录墙保护', () => {
    for (const file of ['day', 'night', 'planter']) {
      expect(proxy(req(`/scenes/street-v1/${file}.webp`)).headers.get('location')).toBeNull();
    }
    for (const path of ['/scenes/street-v1/editor', '/scenes/street-v1/private.json', '/scenes/street-v1/night.webp/secret']) {
      expect(new URL(proxy(req(path)).headers.get('location')!).pathname).toBe('/login');
    }
  });
  it('访客打开管理员根路径邀请链接，首次登录仍携带原令牌', () => {
    // CP admin 路由测试验证生产端生成此格式；Web 消费方保持独立构建。
    const token = '0123456789abcdef'.repeat(2);
    const source = new URL(`https://app.example.com/?invite=${token}`);
    expect(matcherRe().test(source.pathname)).toBe(true);
    const response = proxy(new NextRequest(source));
    const destination = new URL(response.headers.get('location')!);
    expect(destination.origin).toBe(source.origin);
    expect(destination.pathname).toBe('/login');
    expect(destination.searchParams.get('invite')).toBe(token);
  });

  it.each(['https://evil.example', '//evil.example', 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32)])(
    '非法邀请参数不透传且不改变本站登录目标：%s', (invite) => {
      const response = proxy(req(`/?invite=${encodeURIComponent(invite)}&next=https://evil.example`));
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    },
  );
  it('无 session 访问受保护页 → 307 到无副作用的 /login', () => {
    const res = proxy(req('/street'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login');
  });

  it.each(['/', '/settings', '/evolution', '/history'])('未登录 Next 预取 %s 只到登录页，不创建认证状态', (path) => {
    const request = new NextRequest(`http://localhost:3000${path}?_rsc=background`, {
      headers: { 'next-router-prefetch': '1', purpose: 'prefetch', rsc: '1' },
    });
    const response = proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(matcherRe().test(new URL(response.headers.get('location')!).pathname)).toBe(false);
  });

  it.each(['/manifest.webmanifest', '/icons/strayboy-192.png'])('无 session 后台资源 %s 也不能进入认证端点', (path) => {
    const response = proxy(req(path));
    expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('有 session 访问受保护页 → 放行', () => {
    const res = proxy(req('/street', { cookie: `${SESSION_COOKIE}=token` }));
    expect(res.headers.get('location')).toBeNull();
  });

  it('public/pet 素材直通（扁平与一层子目录；不受登录墙约束）', () => {
    expect(proxy(req('/pet/idle.png')).headers.get('location')).toBeNull();
    expect(proxy(req('/pet/strayboy/cat.png')).headers.get('location')).toBeNull();
    expect(proxy(req('/pet/candidates/cat-a.png')).headers.get('location')).toBeNull();
  });

  it('/pet/authorize 之类无扩展名路径不吃素材直通（仍走登录墙）', () => {
    expect(proxy(req('/pet/customize')).headers.get('location')).not.toBeNull();
  });
});

describe('proxy matcher（Next 运行时豁免清单）', () => {
  it('公开页豁免：/login 与 /need-invite（邀请门落地页，CP 未签发 cookie）', () => {
    expect(matcherRe().test('/login')).toBe(false);
    expect(matcherRe().test('/login/sub')).toBe(false);
    expect(matcherRe().test('/need-invite')).toBe(false);
    expect(matcherRe().test('/need-invite/')).toBe(false);
  });

  it('静态资源与认证 API 豁免', () => {
    expect(matcherRe().test('/_next/static/chunk.js')).toBe(false);
    expect(matcherRe().test('/_next/image')).toBe(false);
    expect(matcherRe().test('/favicon.ico')).toBe(false);
    expect(matcherRe().test('/api/state')).toBe(false);
  });

  it('其余页面仍命中登录墙（含 /street、/pet/customize）', () => {
    expect(matcherRe().test('/')).toBe(true);
    expect(matcherRe().test('/street')).toBe(true);
    expect(matcherRe().test('/pet/customize')).toBe(true);
  });
});
