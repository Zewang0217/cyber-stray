"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 邀请面板（#301，维修口第三 tab）——生成 / 列表 / 吊销。
 * raw token 与完整链接仅在生成响应里出现一次（服务端只存哈希），
 * 面板用「复制」按钮把链接交给剪贴板，刷新后不再可得。
 */

interface InviteRow {
  id: string;
  label: string | null;
  createdBy: string;
  createdAt: number;
  revokedAt: number | null;
  consumedAt: number | null;
  consumedTenantId: string | null;
}

export default function InvitesPanel() {
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/invites");
    const json = (await res.json()) as { success: boolean; data?: InviteRow[] };
    setInvites(json.success && json.data ? json.data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setError(null);
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
    });
    const json = (await res.json()) as { success: boolean; data?: { link: string }; error?: string };
    if (!json.success || !json.data) {
      setError(json.error ?? "生成失败");
      return;
    }
    setFreshLink(json.data.link);
    setCopied(false);
    setLabel("");
    await load();
  }

  async function revoke(id: string) {
    setError(null);
    const res = await fetch(`/api/admin/invites/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      setError(json.error ?? "吊销失败");
      return;
    }
    await load();
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-[var(--curb)]">
        邀请链接一次性有效（用后即焚，可吊销）；链接只在生成时展示一次。
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="备注：发给谁（可选）"
          className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1.5 text-[13px] text-[var(--ink)]"
        />
        <button
          type="button"
          onClick={() => void generate()}
          className="sb-shadow border-2 border-black bg-[var(--act)] px-3 py-1.5 text-[13px] text-[var(--sky)]"
        >
          生成邀请链接
        </button>
      </div>

      {error ? <p className="mb-3 text-[13px] text-[var(--bad)]">{error}</p> : null}

      {freshLink ? (
        <div className="mb-4 border-2 border-[var(--ok)] bg-[var(--panel)] p-3">
          <p className="mb-1 break-all text-[13px] text-[var(--ink)]">{freshLink}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(freshLink);
                setCopied(true);
              }}
              className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1 text-[12px] text-[var(--ink)]"
            >
              {copied ? "已复制" : "复制链接"}
            </button>
            <span className="text-[12px] text-[var(--curb)]">关闭本页后不再展示</span>
          </div>
        </div>
      ) : null}

      {invites === null ? (
        <p className="text-[13px] text-[var(--curb)]">加载中…</p>
      ) : invites.length === 0 ? (
        <p className="text-[13px] text-[var(--curb)]">还没有发出过邀请。</p>
      ) : (
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b-2 border-[var(--curb)] text-[var(--curb)]">
              <th className="py-1.5 pr-3">备注</th>
              <th className="py-1.5 pr-3">生成时间</th>
              <th className="py-1.5 pr-3">状态</th>
              <th className="py-1.5 pr-3">被谁使用</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} className="border-b border-[var(--curb)]">
                <td className="py-1.5 pr-3 text-[var(--ink)]">{inv.label ?? "—"}</td>
                <td className="py-1.5 pr-3 text-[var(--curb)]">
                  {new Date(inv.createdAt).toLocaleDateString("zh-CN")}
                </td>
                <td className="py-1.5 pr-3">
                  {inv.consumedAt ? (
                    <span className="text-[var(--ok)]">已使用</span>
                  ) : inv.revokedAt ? (
                    <span className="text-[var(--bad)]">已吊销</span>
                  ) : (
                    <span className="text-[var(--ink)]">未使用</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-[var(--curb)]">{inv.consumedTenantId ?? "—"}</td>
                <td className="py-1.5">
                  {!inv.consumedAt && !inv.revokedAt ? (
                    <button
                      type="button"
                      onClick={() => void revoke(inv.id)}
                      className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-0.5 text-[12px] text-[var(--ink)]"
                    >
                      吊销
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
