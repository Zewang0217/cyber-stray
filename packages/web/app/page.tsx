import { redirect } from "next/navigation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@cyber-stray/shared/sprite";
import { StreetCorner } from "@/components/strayboy/StreetCorner";

/**
 * 街角页（服务端壳）：帧表契约在服务端读盘并校验，交互体下沉 client。
 * ?demo=1 = 夹具数据的视觉验收模式（无 Casdoor 会话时人眼评审用）。
 */
export default async function StreetCornerPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; invite?: string }>;
}) {
  const sp = await searchParams;
  // 邀请链接落在首页（#301）：原样转发进登录流，token 穿越到 CP callback 消费
  if (sp.invite) redirect(`/login?invite=${encodeURIComponent(sp.invite)}`);
  const contract = parseSpriteContract(
    JSON.parse(readFileSync(join(process.cwd(), "public/pet/strayboy/frames.json"), "utf8")),
  );
  return <StreetCorner contract={contract} demo={sp.demo === "1"} />;
}
