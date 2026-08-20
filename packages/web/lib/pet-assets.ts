/**
 * 宠物素材消费（#95 IP 消费侧）— 按租户加载自定义 IP 素材 + 程序微动画参数
 *
 * web 是只读消费方：经 next rewrite 代理到控制面，不碰文件系统。
 * 加载路径：
 * 1. GET /api/pet/manifest → 本租户自定义素材清单（含状态表；由 #94 生成管线落盘）
 * 2. 有自定义 → 素材走 /api/pet-assets/<file>（租户私有，鉴权服务）；
 *    无自定义 / 未登录 / 网络失败 → 回退内置 public/pet（PET_STATES）
 *
 * 播放器程序微动画（frames:1 单帧静态 + 程序补动）：每状态一组 keyframes，
 * 交给 framer-motion 无限循环。多帧素材（内置，frames:3）保持 JS 帧驱动，
 * 向后兼容——由 spec.frames 决定走哪条路径，两者共用同一状态注册表。
 *
 * 消费侧 graceful degradation：manifest 拉取失败（无自定义/未登录/网络）一律
 * 回退内置素材——宠物是页面核心，绝不被 manifest 端点失败阻断（有意取舍，
 * 非吞错掩盖损坏：损坏 manifest 走 4xx/5xx 同样回退，页面照常展示内置宠物）。
 */

import { useEffect, useState } from "react";
import type { Transition } from "framer-motion";
import type { PetAssetManifest, PetStateId } from "@cyber-stray/shared/pet";

/** 程序微动画 keyframes（每状态 1 帧静态 + 程序补动；与 PET_STATES 状态一一对应） */
const PROCEDURAL_KEYFRAMES: Record<PetStateId, Record<string, number[]>> = {
  idle: { scale: [1, 1.05, 1] }, // 呼吸
  walk: { x: [0, 8, 0] }, // 位移
  joy: { y: [0, -4, 0] },
  eat: { scale: [1, 0.97, 1] },
  sleep: { scale: [1, 1.03, 1] }, // 慢呼吸
  think: { rotate: [0, 3, 0] },
  celebrate: { y: [0, -10, 0] }, // 弹跳
  grumpy: { rotate: [0, -2, 0] },
  welcome: { y: [0, -6, 0] },
};

/** framer-motion 程序微动画配置（animate keyframes + 无限循环 transition） */
export interface ProceduralMotion {
  animate: Record<string, number[]>;
  transition: Transition;
}

/**
 * 单状态程序微动画配置（纯函数，可测）。dur 取素材规格（manifest 或 PET_STATES）。
 * 未知状态抛错（禁兜底——调用方不应静默拿到错误动画）。
 */
export function proceduralMotionFor(state: PetStateId, dur: number): ProceduralMotion {
  const keyframes = PROCEDURAL_KEYFRAMES[state];
  if (!keyframes) {
    throw new Error(`未知宠物状态: ${String(state)}（程序微动画表中不存在）`);
  }
  return {
    animate: keyframes,
    transition: { duration: dur, repeat: Infinity, ease: "easeInOut" },
  };
}

/** 模块级缓存：manifest 每租户固定（会话内不变），全页只拉一次 */
let manifestPromise: Promise<PetAssetManifest | null> | null = null;

/**
 * 拉取本租户自定义素材清单；无自定义 / 未登录 / 网络失败 → null（回退内置）。
 * 结果按会话缓存（登出换租户时调用 resetPetManifest 清除）。
 */
export function loadPetManifest(): Promise<PetAssetManifest | null> {
  manifestPromise ??= (async () => {
    try {
      const res = await fetch("/api/pet/manifest");
      // 404（无自定义）/ 401（未登录）/ 非 2xx → 无自定义，回退内置
      if (!res.ok) return null;
      return (await res.json()) as PetAssetManifest;
    } catch {
      return null; // 网络失败 → 回退内置（消费侧 graceful degradation）
    }
  })();
  return manifestPromise;
}

/** 清除 manifest 缓存（测试 / 登出换租户用；正常会话流程无需调用） */
export function resetPetManifest(): void {
  manifestPromise = null;
}

/** 宠物素材 hook：拉取本租户 manifest（含自定义与否的加载态） */
export function usePetAssets(): {
  manifest: PetAssetManifest | null;
  loaded: boolean;
} {
  const [manifest, setManifest] = useState<PetAssetManifest | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadPetManifest().then((m) => {
      if (cancelled) return;
      setManifest(m);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { manifest, loaded };
}
