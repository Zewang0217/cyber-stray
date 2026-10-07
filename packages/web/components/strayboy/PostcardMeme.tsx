"use client";

import { useState } from "react";
import Image from "next/image";

/** 展示控制面投影的租户表情包地址；加载失败时明确告知读者。 */
export function PostcardMeme({ imageUrl }: { imageUrl: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className="mb-4 ml-5 max-w-64 border-2 border-[var(--ink)] bg-[var(--panel)] p-2">
      {failed
        ? <p className="font-noto py-8 text-center text-[13px] text-[var(--paper)]">表情包暂时无法加载</p>
        : <Image src={imageUrl} alt="猫寄回的表情包" width={256} height={256} unoptimized
            onError={() => setFailed(true)}
            className="pixelated aspect-square w-full object-contain" />}
      <figcaption className="mt-2 font-mono text-[11px] text-[var(--paper)]">猫顺手画的 · MEME</figcaption>
    </figure>
  );
}
