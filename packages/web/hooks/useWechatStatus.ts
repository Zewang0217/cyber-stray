"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 微信通道状态 Hook（#97）：GET /api/wechat/status（登录态）。
 * 设置页展示：未绑定 / 已绑定（active|paired）/ 已过期（提示重新激活）。
 */

export interface WechatStatus {
  bound: boolean;
  status?: "paired" | "active" | "expired";
  expiredHint?: string;
  /** 已绑定时返回：本租户 id（设置页"重新激活"链接携带,服务端做 pairing 白名单） */
  tenantId?: string;
}

interface UseWechatStatusReturn {
  status: WechatStatus | null;
  refresh: () => Promise<void>;
}

export function useWechatStatus(): UseWechatStatusReturn {
  const [status, setStatus] = useState<WechatStatus | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/wechat/status");
      const json = (await res.json()) as { success: boolean; data?: WechatStatus };
      if (json.success && json.data) setStatus(json.data);
    } catch {
      // 未登录等场景静默——页面级鉴权已兜
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, refresh };
}
