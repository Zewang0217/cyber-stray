import { NextResponse, type NextRequest } from "next/server";

/**
 * 登录墙（S2）：未登录访问跳转 Casdoor 登录。
 *
 * 只查 session cookie 存在性——验签由控制面做（web 是只读消费方，
 * 不持有 CP_SESSION_SECRET）。页面数据经 rewrites 走控制面 API（S6：
 * 鉴权 + 按会话租户路由），本文件只管页面级登录墙。
 */
// cookie 名的规范定义在 control-plane/src/session.ts（SESSION_COOKIE），改名需两侧同步
const SESSION_COOKIE = "cs_session";

/** public/pet/ 内置素材扩展名直通（不拦登录；/pet/customize 页面仍走登录墙，#94） */
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
  // 排除静态资源、认证 API 与公开页（API 由控制面接管；#97 微信绑定页是
  // 扫码即用入口——无 Casdoor 会话也能访问）。pet/ 不再整体豁免——
  // /pet/customize（#94）需登录，public/pet 素材在 proxy 内按扩展名直通
  // /login（#195）为免登录像素页（电源键发起 Casdoor 流程），同样豁免登录墙
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|wechat(?:/|$)|login(?:/|$)).*)"],
};
