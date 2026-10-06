import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@cyber-stray/shared/session";
import { isInviteToken } from "@cyber-stray/shared/invite";

/**
 * 登录墙：未登录访问跳转公开登录页，由用户点 POWER 发起 Casdoor 登录。
 *
 * 只查 session cookie 存在性——验签由控制面做（web 是只读消费方，不持有
 * 会话密钥）。页面数据经 rewrites 走控制面 API（鉴权 + 按会话租户路由），
 * 本文件只管页面级登录墙。cookie 名契约在 shared/session。
 */

/** public/pet/ 内置素材扩展名直通（不拦登录；/pet/customize 页面仍走登录墙）。
 *  允许一层子目录：内置精灵图在 /pet/strayboy/、候选图在 /pet/candidates/ */
const PET_ASSET_RE = /^\/pet\/[^/]+(?:\/[^/]+)?\.(png|jpe?g|webp|glb|gif)$/;

export function proxy(request: NextRequest) {
  // 静态素材直接放行（middleware 对 public 文件同样生效，需先于登录墙判断）
  if (PET_ASSET_RE.test(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    // Next 链接预取也会经过此处；直接进认证端点会在后台覆盖用户正在使用的
    // OIDC state cookie。登录页本身无认证副作用，只有原生 POWER 链接创建 state。
    const loginUrl = new URL("/login", request.url);
    // 首页邀请链接先经过 proxy；保留合法凭据供登录页 POWER 链接透传。
    const invite = request.nextUrl.searchParams.get("invite");
    if (isInviteToken(invite)) loginUrl.searchParams.set("invite", invite);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // 排除静态资源、认证 API 与公开页（API 由控制面接管）。/pet/customize
  // 需登录，public/pet 素材在 proxy 内按扩展名直通；/login 为免登录像素页；
  // /need-invite 必须豁免——CP 在邀请校验失败时把用户 302 到这里且尚未签发
  // session cookie（见 CP routes/auth.ts 邀请门），登录墙若拦截此页会形成
  // 登录→callback→need-invite→登录 的重定向死循环
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|login(?:/|$)|need-invite(?:/|$)).*)"],
};
