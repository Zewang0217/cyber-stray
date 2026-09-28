"use client";

import { useEffect, useState } from "react";
import type { PetAssetManifest } from "@cyber-stray/shared/pet";

interface UsePetManifestReturn {
  /** 本租户自定义素材 manifest；null = 无素材（404）/拉取失败 → 回退内置猫 */
  manifest: PetAssetManifest | null;
  /** 首次拉取完成（无论结果）；避免挂载期闪换形象 */
  loaded: boolean;
  /** 最近一次拉取失败原因（404 不算失败——是文档化的无素材语义） */
  error: string | null;
}

/**
 * 本租户宠物素材 manifest（GET /api/pet/manifest，rewrite 代理 CP，session 鉴权）。
 *
 * - 404（无自定义素材）→ manifest null，街角用内置猫——文档化的产品行为，
 *   非错误吞没（pet-assets 路由注释同款语义）。
 * - refreshToken 变化（pet_assets_ready SSE 事件）→ 重拉，素材就绪热替换。
 * - 网络失败同样回退内置猫并 warn：展示层资产缺失不阻断街角主功能。
 */
export function usePetManifest(options: { enabled?: boolean; refreshToken?: number } = {}): UsePetManifestReturn {
  const { enabled = true, refreshToken = 0 } = options;
  const [manifest, setManifest] = useState<PetAssetManifest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/pet/manifest");
        if (res.status === 404) {
          // 无自定义素材 = 文档化产品语义（非错误），回退内置猫
          if (!cancelled) {
            setManifest(null);
            setError(null);
            setLoaded(true);
          }
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        // manifest.json 原样返回（非 success 包装），形状由 CP finalize 契约保证
        const data = (await res.json()) as PetAssetManifest;
        if (!cancelled) {
          setManifest(data);
          setError(null);
          setLoaded(true);
        }
      } catch (err) {
        // 展示层资产缺失不阻断街角主功能，但失败原因对调用方可见（不吞成 404）
        console.warn("[pet-manifest] 拉取失败，回退内置猫：", err);
        if (!cancelled) {
          setManifest(null);
          setError(err instanceof Error ? err.message : String(err));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshToken]);

  return { manifest, loaded, error };
}
