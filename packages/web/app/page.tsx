import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@/lib/strayboy/sprite";
import { StreetCorner } from "@/components/strayboy/StreetCorner";

/**
 * 街角页（服务端壳）：帧表契约在服务端读盘并校验，交互体下沉 client。
 * ?demo=1 = 夹具数据的视觉验收模式（无 Casdoor 会话时人眼评审用）。
 */
export default async function StreetCornerPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const sp = await searchParams;
  const contract = parseSpriteContract(
    JSON.parse(readFileSync(join(process.cwd(), "public/pet/strayboy/frames.json"), "utf8")),
  );
  return <StreetCorner contract={contract} demo={sp.demo === "1"} />;
}
