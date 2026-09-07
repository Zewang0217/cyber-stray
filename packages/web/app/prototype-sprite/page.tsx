import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@/lib/strayboy/sprite";
import { PetSprite } from "@/components/strayboy/PetSprite";

/**
 * PROTOTYPE（T1-sprite 票 #186 验收页，用后即弃——街角票 #187 落地时删除）：
 * 全部 11 动作 + 饥饿叠加的播放演示。
 */
export default function PrototypeSpritePage() {
  const contract = parseSpriteContract(
    JSON.parse(readFileSync(join(process.cwd(), "public/pet/strayboy/frames.json"), "utf8")),
  );
  const anims = Object.keys(contract.animations);

  return (
    <div className="sb bg-[var(--sky)] p-6">
      <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">PROTOTYPE · SPRITE PLAYER</h1>
      <p className="mb-6 text-[13px] text-[var(--curb)]">
        票 #186 验收演示页（T1-3 街角落地时删除）· 11 动作 × steps() 播放
      </p>
      <div className="flex flex-wrap gap-6">
        {anims.map((anim) => (
          <figure key={anim} className="text-center">
            <PetSprite contract={contract} anim={anim} scale={3} hungry={anim === "idle"} />
            <figcaption className="font-vt323 mt-2 text-[16px] text-[var(--curb)]">
              {anim}
              {anim === "idle" ? " · hungry" : ""}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
