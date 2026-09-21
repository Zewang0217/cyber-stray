"use client";

import { useEffect, useState } from "react";
import type { PushState } from "@/hooks/useWebPush";

/** iOS 判定（iPadOS 13+ 桌面 UA 也算） */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** 是否已安装到主屏（standalone 模式） */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari 专有字段
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * 通知补开横幅（#275 决议 #270-2 拒绝路径）：
 * 领养时拒绝/未授权通知 → 首页常驻横幅讲后果（「它找不到你」）+ 补开入口；
 * 设置页入口不动。iOS 未安装到主屏时换装提示（iOS 只给主屏 PWA 发通知）。
 * 已订阅（on）/设备根本不支持（非 iOS）→ 不渲染。
 */
export function PushNudgeBanner({
  state,
  error,
  onEnable,
}: {
  state: PushState;
  error: string | null;
  onEnable: () => void;
}) {
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => {
    setIos(isIOS());
    setStandalone(isStandalone());
  }, []);

  // 订阅中/失败重试中显示轻态；已订阅不显示
  if (state === "on") return null;

  // iOS 未上主屏：PushManager 缺失（unsupported），装到主屏后才有通知能力
  if (state === "unsupported") {
    if (ios && !standalone) {
      return (
        <div className="border-2 border-black bg-[var(--panel)] px-3 py-2 text-[12px] leading-[1.6] text-[var(--paper)] shadow-[4px_4px_0_#000]">
          📬 iPhone 收明信片需要先把「街溜子」添加到主屏幕（分享菜单 → 添加到主屏幕）——不然它出门找不到你。
        </div>
      );
    }
    return null;
  }

  if (state === "off" || state === "error") {
    return (
      <div className="flex items-center justify-between gap-2 border-2 border-black bg-[var(--panel)] px-3 py-2 shadow-[4px_4px_0_#000]">
        <p className="text-[12px] leading-[1.6] text-[var(--paper)]">
          {error ? `通知开启失败：${error}` : "它出门会给你寄明信片——但通知还没开，它找不到你。"}
        </p>
        <button
          type="button"
          onClick={onEnable}
          className="sb-shadow shrink-0 border-2 border-black bg-[var(--act)] px-2 py-1 text-[11px] text-[var(--sky)]"
        >
          {state === "error" ? "重试" : "开启通知"}
        </button>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="border-2 border-black bg-[var(--panel)] px-3 py-2 text-[12px] leading-[1.6] text-[var(--paper)] shadow-[4px_4px_0_#000]">
        🔕 通知权限被浏览器拒绝了——它寄的明信片你收不到。可到浏览器的站点设置里给「街溜子」补开通知。
      </div>
    );
  }

  return null; // subscribing：横幅闪一下反而吵，等结果
}
