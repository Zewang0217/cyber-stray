"use client";

import { useState } from "react";
import { petAnimationFor, type PetAppearance } from "@cyber-stray/shared/pet-appearance";
import type { SpriteContract } from "@cyber-stray/shared/sprite";
import { PetSprite } from "./PetSprite";
import styles from "./StreetPet.module.css";

const CUSTOM_ASSET_BASE = "/api/pet-assets";
const CLASSIC_DISPLAY_SIZE = 96;

interface StreetPetProps {
  contract: SpriteContract;
  appearance: PetAppearance | null;
  loaded: boolean;
  error: string | null;
  anim: string;
  hungry?: boolean;
  coat?: "orange" | "black" | "calico";
}

/** 街角/待机演出共用选择：仅「无自定义素材」使用内置猫，加载错误必须可见。 */
export function StreetPet({ contract, appearance, loaded, error, anim, hungry, coat }: StreetPetProps) {
  if (error) return <AssetError message={error} />;
  if (!loaded) return <span role="status" className="text-xs text-[var(--curb)]">外观加载中…</span>;
  if (!appearance) return <PetSprite contract={contract} anim={anim} hungry={hungry} coat={coat} />;
  return <CustomPet key={`${appearance.kind}:${appearance.generatedAt}`} appearance={appearance} anim={anim} />;
}

function AssetError({ message }: { message: string }) {
  return <span role="alert" className="inline-block max-w-60 border-2 border-[var(--act)] bg-[var(--sky)] p-2 text-xs leading-relaxed text-[var(--act)]">外观加载失败：{message}</span>;
}

/** 单帧九态按状态切 PNG + steps 微动；sheet 沿用帧播放器。新生成版本清除旧加载错误。 */
function CustomPet({ appearance, anim }: { appearance: PetAppearance; anim: string }) {
  const [error, setError] = useState<string | null>(null);
  const state = petAnimationFor(appearance.kind, anim);
  const filename = appearance.kind === "states" ? `${appearance.states[state].file}.png` : appearance.contract.image;
  // CP 同路径原子替换 manifest；生成时间作为资源版本，避免浏览器沿用旧 PNG 缓存。
  const versionedFile = `${filename}?v=${encodeURIComponent(appearance.generatedAt)}`;
  const src = `${CUSTOM_ASSET_BASE}/${versionedFile}`;
  const onError = () => setError(`无法读取素材 ${filename}，请先刷新页面重试；持续失败再重新生成外观。`);
  if (error) return <AssetError message={error} />;
  if (appearance.kind === "states") {
    const spec = appearance.states[state];
    return (
      // 受 session 保护的 PNG 必须原址加载；图片优化代理不持有租户 session。
      // eslint-disable-next-line @next/next/no-img-element
      <img key={src} src={src} alt={spec.label} width={CLASSIC_DISPLAY_SIZE} height={CLASSIC_DISPLAY_SIZE}
        className={styles.classic} data-anim={state} style={{ animationDuration: `${spec.dur}s` }} onError={onError} />
    );
  }
  return (
    <>
      {/* CSS 背景无 error 事件；同源探针复用图片缓存，使坏图明确可见。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={src} hidden alt="" src={src} onError={onError} />
      <PetSprite contract={{ ...appearance.contract, image: versionedFile }} anim={state}
        scale={appearance.scale} basePath={CUSTOM_ASSET_BASE} />
    </>
  );
}
