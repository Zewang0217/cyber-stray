"use client";

import { useCallback, useEffect, useState } from "react";

interface ChannelsState {
  feishu: boolean;
  webPush: "default";
}

interface UseChannelsReturn {
  channels: ChannelsState | null;
  error: string | null;
  bindFeishu: (webhook: string) => Promise<boolean>;
  unbindFeishu: () => Promise<boolean>;
}

/**
 * 通道绑定 Hook（S10）：GET /api/channels + PUT/DELETE /api/channels/feishu。
 */
export function useChannels(): UseChannelsReturn {
  const [channels, setChannels] = useState<ChannelsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/channels");
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: ChannelsState;
      };
      if (json.success && json.data) {
        setChannels(json.data);
        setError(null);
      }
    } catch {
      // 未登录等场景静默——页面级鉴权已兜
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bindFeishu = useCallback(
    async (webhook: string): Promise<boolean> => {
      const res = await fetch("/api/channels/feishu", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhook }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setError(json.error ?? "绑定失败");
        return false;
      }
      setError(null);
      await refresh();
      return true;
    },
    [refresh],
  );

  const unbindFeishu = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/channels/feishu", { method: "DELETE" });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!json.success) {
      setError(json.error ?? "解绑失败");
      return false;
    }
    setError(null);
    await refresh();
    return true;
  }, [refresh]);

  return { channels, error, bindFeishu, unbindFeishu };
}
