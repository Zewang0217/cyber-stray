"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 微信扫码绑定 Hook（#97）：扫码即用（公开页，无需 Casdoor 会话）。
 * POST /api/wechat/bind/start → 轮询 GET /api/wechat/bind/status。
 */

export interface WechatBindResult {
  tenantId: string;
  petName: string;
  created: boolean;
}

export interface WechatBindStatus {
  status: "wait" | "scaned" | "confirmed" | "expired" | "error" | "not_found";
  error?: string;
  result?: WechatBindResult;
}

interface UseWechatBindReturn {
  phase: "idle" | "starting" | "waiting" | "scaned" | "confirmed" | "expired" | "error";
  qrcodeImgUrl: string | null;
  error: string | null;
  result: WechatBindResult | null;
  start: (tenantId?: string) => Promise<void>;
  reset: () => void;
}

export function useWechatBind(): UseWechatBindReturn {
  const [phase, setPhase] = useState<UseWechatBindReturn["phase"]>("idle");
  const [qrcodeImgUrl, setQrcodeImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WechatBindResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const start = useCallback(async (tenantId?: string): Promise<void> => {
    setPhase("starting");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/wechat/bind/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tenantId ? { tenantId } : {}),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { sessionId: string; qrcodeImgUrl: string; expiresAt: number };
      };
      if (!json.success || !json.data) {
        setError(json.error ?? "获取二维码失败");
        setPhase("error");
        return;
      }
      setQrcodeImgUrl(json.data.qrcodeImgUrl);
      setSessionId(json.data.sessionId);
      setPhase("waiting");
    } catch {
      setError("网络错误,请重试");
      setPhase("error");
    }
  }, []);

  // 轮询绑定状态（2s；confirmed/expired/error 停止）
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/wechat/bind/status?session=${encodeURIComponent(sessionId)}`);
        const json = (await res.json()) as { success: boolean; data?: WechatBindStatus };
        if (cancelled || !json.success || !json.data) return;
        if (json.data.status === "scaned") {
          setPhase("scaned");
        } else if (json.data.status === "confirmed" && json.data.result) {
          setResult(json.data.result);
          setPhase("confirmed");
          clearInterval(timer);
        } else if (json.data.status === "expired" || json.data.status === "error") {
          setError(json.data.error ?? "绑定失败,请重试");
          setPhase(json.data.status === "expired" ? "expired" : "error");
          clearInterval(timer);
        } else if (json.data.status === "not_found") {
          setError("绑定会话已失效,请重新发起");
          setPhase("error");
          clearInterval(timer);
        }
      } catch {
        // 网络抖动：跳过本轮，下轮重试
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  const reset = useCallback(() => {
    setPhase("idle");
    setQrcodeImgUrl(null);
    setError(null);
    setResult(null);
    setSessionId(null);
  }, []);

  return { phase, qrcodeImgUrl, error, result, start, reset };
}
