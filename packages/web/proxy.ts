import { NextResponse, type NextRequest } from "next/server";

/**
 * 登录墙（S2）：未登录访问跳转 Casdoor 登录。
 *
 * 只查 session cookie 存在性——验签由控制面 /api/auth/me 做（web 是只读消费方，
 * 不持有 CP_SESSION_SECRET）。页面数据本身仍是本地 agent 数据（单用户开发期）；
 * S6 数据路由后页面数据走控制面 API 鉴权。
 */
// cookie 名的规范定义在 control-plane/src/session.ts（SESSION_COOKIE），改名需两侧同步
const SESSION_COOKIE = "cs_session";

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL("/api/auth/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // 排除静态资源与认证 API 本身（API 由控制面接管）
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
