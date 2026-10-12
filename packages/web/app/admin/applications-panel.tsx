"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AdminApplicationSchema,
  APPLICATION_STATUS_LABELS,
  type AdminApplication,
} from "@cyber-stray/shared/invite-application";

/**
 * 申请审批面板（维修口第四 tab）：公开申请列表 + 批准（生成单人邀请并
 * 绑定）/ 回绝。批准后邀请链接同时发给申请者（凭据对取回）与这里（复制）。
 */

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function requestApplications<T>(path: string, method: string, schema: { parse: (v: unknown) => T }): Promise<T> {
  const res = await fetch(path, { method });
  const json = (await res.json()) as Envelope<T>;
  if (!res.ok || !json.success || json.data === undefined) throw new Error(json.error ?? `请求失败（${res.status}）`);
  return schema.parse(json.data);
}

export default function ApplicationsPanel() {
  const [apps, setApps] = useState<AdminApplication[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setApps(await requestApplications("/api/admin/applications", "GET", AdminApplicationSchema.array()));
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : "申请列表加载失败"));
  }, [load]);

  async function decide(id: string, action: "approve" | "reject") {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await requestApplications(`/api/admin/applications/${id}/${action}`, "POST", AdminApplicationSchema);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(app: AdminApplication) {
    if (!app.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(app.inviteUrl);
      setCopiedId(app.id);
    } catch {
      setError("复制失败，请手动选中复制。");
    }
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-[var(--curb)]">
        官网公开申请（不收集邮箱）：批准即生成单人邀请并绑定该申请，申请人凭「申请号 + 查询码」在 /apply 取链接。
      </p>
      {error ? <p className="mb-3 text-[13px] text-[var(--bad)]">{error}</p> : null}
      {apps === null ? (
        <p className="text-[13px] text-[var(--curb)]">加载中…</p>
      ) : apps.length === 0 ? (
        <p className="text-[13px] text-[var(--curb)]">还没有收到申请。</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b-2 border-[var(--curb)] text-[var(--curb)]">
              <th className="py-1.5 pr-3">申请号</th>
              <th className="py-1.5 pr-3">称呼</th>
              <th className="py-1.5 pr-3">理由</th>
              <th className="py-1.5 pr-3">递信时间</th>
              <th className="py-1.5 pr-3">状态</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.id} className="border-b border-[var(--curb)] align-top">
                <td className="py-1.5 pr-3 font-vt323 text-[16px] text-[var(--paper)]">{app.publicId}</td>
                <td className="py-1.5 pr-3 text-[var(--paper)]">{app.nickname ?? "—"}</td>
                <td className="max-w-[22rem] py-1.5 pr-3 text-[var(--paper)]">{app.reason}</td>
                <td className="py-1.5 pr-3 text-[var(--curb)]">{new Date(app.createdAt).toLocaleString("zh-CN")}</td>
                <td className="py-1.5 pr-3">
                  <span className={app.status === "approved" ? "text-[var(--ok)]" : app.status === "rejected" ? "text-[var(--bad)]" : "text-[var(--hi)]"}>
                    {APPLICATION_STATUS_LABELS[app.status]}
                  </span>
                </td>
                <td className="py-1.5">
                  {app.status === "pending" ? (
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busyId === app.id}
                        onClick={() => void decide(app.id, "approve")}
                        className="border-2 border-[var(--ink)] bg-[var(--hi)] px-2 py-0.5 text-[12px] text-[var(--ink)] disabled:opacity-40">
                        批准发码
                      </button>
                      <button type="button" disabled={busyId === app.id}
                        onClick={() => void decide(app.id, "reject")}
                        className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-0.5 text-[12px] text-[var(--ink)] disabled:opacity-40">
                        回绝
                      </button>
                    </div>
                  ) : app.status === "approved" && app.inviteUrl ? (
                    <button type="button" onClick={() => void copyLink(app)}
                      className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-0.5 text-[12px] text-[var(--ink)]">
                      {copiedId === app.id ? "已复制链接" : "复制邀请链接"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
