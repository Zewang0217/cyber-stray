"use client";

import { useCallback, useEffect, useState } from "react";

/** urlBase64ToUint8Array：VAPID applicationServerKey 转换（浏览器要求） */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type PushState = "unsupported" | "denied" | "off" | "subscribing" | "on" | "error";

interface UseWebPushReturn {
  state: PushState;
  error: string | null;
  /** 订阅系统推送（注册 SW → 请求权限 → POST /api/push/subscribe） */
  enable: () => Promise<void>;
  /** 退订（DELETE /api/push/subscribe + 浏览器侧取消） */
  disable: () => Promise<void>;
}

/**
 * Web Push 订阅 Hook（S10，#77）。
 *
 * headless/无通知权限环境 unsupported/denied——UI 据此隐藏开关。
 * 订阅归属 session 租户（服务端定），重复订阅幂等刷新。
 */
export function useWebPush(): UseWebPushReturn {
  const [state, setState] = useState<PushState>("off");
  const [error, setError] = useState<string | null>(null);

  // 初始化：探测支持/权限/已有订阅
  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("error"));
  }, []);

  const enable = useCallback(async (): Promise<void> => {
    setError(null);
    setState("subscribing");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        setError("未授予通知权限");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const keyRes = await fetch("/api/push/vapid-key");
      const keyJson = (await keyRes.json()) as { success: boolean; data?: { publicKey: string } };
      if (!keyJson.success || !keyJson.data) {
        throw new Error("获取推送公钥失败");
      }

      // 已有订阅且未变则复用；否则新建（applicationServerKey 换代时重订）
      let sub = await reg.pushManager.getSubscription();
      sub =
        sub ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyJson.data.publicKey) as BufferSource,
        }));
      const subJson = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: { p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth },
        }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? "订阅登记失败");

      setState("on");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "订阅失败");
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // 服务端先退订：失败（会话过期/网络）保留本地订阅与状态，
        // 否则服务端残留死行、用户还会多收一次通知
        const res = await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        const json = (await res.json()) as { success: boolean; error?: string };
        if (!json.success) {
          setError(json.error ?? "退订失败");
          return;
        }
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "退订失败");
    }
  }, []);

  return { state, error, enable, disable };
}
