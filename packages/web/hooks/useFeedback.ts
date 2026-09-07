"use client";

import { useCallback, useState } from "react";

/**
 * 反馈提交状态
 */
interface FeedbackState {
  /** 本条反馈已成功提交的类型（like/dislike） */
  submitted: "like" | "dislike" | null;
  /** 提交中 */
  pending: boolean;
  /** 错误消息（如顶话题节流 429） */
  error: string | null;
}

interface UseFeedbackReturn extends FeedbackState {
  /** 点赞/踩（不受限，低价值高频信号；S9 #76） */
  sendFeedback: (type: "like" | "dislike", messageId: string) => Promise<boolean>;
  /** 顶话题（按 plan 节流；S9 #76）。返回是否成功（429/网络失败为 false） */
  boostTopic: (topic: string) => Promise<boolean>;
}

/**
 * 反馈提交 Hook（S9）：POST /api/feedback 与 /api/boost。
 *
 * 节流错误（429）以 error 返回由 UI 呈现，不抛出。
 */
export function useFeedback(): UseFeedbackReturn {
  const [state, setState] = useState<FeedbackState>({
    submitted: null,
    pending: false,
    error: null,
  });

  const post = useCallback(
    async (url: string, body: Record<string, string>): Promise<boolean> => {
      setState((s) => ({ ...s, pending: true, error: null }));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { success: boolean; error?: string };
        if (!json.success) {
          setState((s) => ({ ...s, pending: false, error: json.error ?? "提交失败" }));
          return false;
        }
        setState((s) => ({ ...s, pending: false }));
        return true;
      } catch {
        setState((s) => ({ ...s, pending: false, error: "网络错误" }));
        return false;
      }
    },
    [],
  );

  const sendFeedback = useCallback(
    async (type: "like" | "dislike", messageId: string): Promise<boolean> => {
      const ok = await post("/api/feedback", { type, messageId });
      if (ok) setState((s) => ({ ...s, submitted: type }));
      return ok;
    },
    [post],
  );

  const boostTopic = useCallback(
    async (topic: string): Promise<boolean> => post("/api/boost", { topic }),
    [post],
  );

  return { ...state, sendFeedback, boostTopic };
}
