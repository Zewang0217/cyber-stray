import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@cyber-stray/shared/sprite";
import { SESSION_COOKIE } from "@cyber-stray/shared/session";
import { StreetCorner } from "@/components/strayboy/StreetCorner";
import { LandingPage } from "@/components/landing/LandingPage";

/**
 * 产品根路径（GitHub 式入口，#408 Decision 6）：无有效 session（含失效 cookie）
 * 渲染官网落地页，已登录保持原有街角页。
 *
 * session 判定 = cookie 存在性——与 proxy 登录墙同一机制同一 cookie 名契约
 * （shared/session）；验签归控制面，web 是只读消费方，不持有会话密钥。失效
 * cookie 同样落落地页：过期 JWT 的页面数据请求会被 CP 401，而落地页只读本地
 * 帧表，无数据依赖。分流只作用于本路径，其余公开页（/login、/apply、
 * /need-invite）不受影响。
 *
 * cookie 判定使本路由为动态渲染；?demo=1 = 街角夹具数据的视觉验收
 * 模式，?invite= = 邀请链接（原样转发进登录流，token 穿越到 CP callback 消费）。
 */

/** 未登录时本页是官网落地页，metadata 用官网文案（登录后沿用 layout 的仪表盘文案）。 */
export async function generateMetadata(): Promise<Metadata> {
  const hasSession = (await cookies()).has(SESSION_COOKIE);
  if (hasSession) return {};
  return {
    title: "Cyber Stray · 一只活在云端的街猫",
    description:
      "一台掌机，一座夜城，一只自己会动的猫。自进化赛博宠物：它自己探索、学习、进化兴趣，把你会感兴趣的内容寄成明信片给你。",
    openGraph: {
      title: "Cyber Stray · 一只活在云端的街猫",
      description: "它自己游荡、学习、进化兴趣，把你会感兴趣的东西从城里寄成明信片给你。",
      type: "website",
      locale: "zh_CN",
    },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; invite?: string }>;
}) {
  const sp = await searchParams;
  // 邀请链接落在首页（#301）：原样转发进登录流，token 穿越到 CP callback 消费
  if (sp.invite) redirect(`/login?invite=${encodeURIComponent(sp.invite)}`);
  if (!(await cookies()).has(SESSION_COOKIE)) return <LandingPage />;
  const contract = parseSpriteContract(
    JSON.parse(readFileSync(join(process.cwd(), "public/pet/strayboy/frames.json"), "utf8")),
  );
  return <StreetCorner contract={contract} demo={sp.demo === "1"} />;
}
