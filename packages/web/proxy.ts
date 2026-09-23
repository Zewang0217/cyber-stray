import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@cyber-stray/shared/session";

/**
 * 登录墙：未登录访问跳转 Casdoor 登录。
 *
 * 只查 session cookie 存在性——验签由控制面做（web 是只读消费方，不持有
 * 会话密钥）。页面数据经 rewrites 走控制面 API（鉴权 + 按会话租户路由），
 * 本文件只管页面级登录墙。cookie 名契约在 shared/session。
 */

/** public/pet/ 内置素材扩展名直通（不拦登录；/pet/customize 页面仍走登录墙） */
const PET_ASSET_RE = /^\/pet\/[^/]+\.(png|jpe?g|webp|glb|gif)$/;

export function proxy(request: NextRequest) {
  // 静态素材直接放行（middleware 对 public 文件同样生效，需先于登录墙判断）
  if (PET_ASSET_RE.test(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL("/api/auth/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // 排除静态资源、认证 API 与公开页（API 由控制面接管）。/pet/customize
  // 需登录，public/pet 素材在 proxy 内按扩展名直通；/login 为免登录像素页
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|login(?:/|$)).*)"],
};
