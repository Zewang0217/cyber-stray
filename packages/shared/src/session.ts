/**
 * web↔CP 会话 cookie 名：CP 登录成功后签发 httpOnly session JWT，
 * web 中间件只查 cookie 存在性做登录墙（验签在 CP）。
 */
export const SESSION_COOKIE = 'cs_session';
