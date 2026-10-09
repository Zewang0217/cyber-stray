"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CreateInviteSchema, InvitePublicSchema, MAX_INVITE_USES, inviteAvailability, type InvitePublic } from "@cyber-stray/shared/invite";

/**
 * 邀请面板（#301，维修口第三 tab）——生成 / 列表 / 吊销。
 * raw token 与完整链接仅在生成响应里出现一次（服务端只存哈希），
 * 面板用「复制」按钮把链接交给剪贴板，刷新后不再可得。
 */

/** 所有邀请响应在一处校验 envelope 与各操作的数据契约。 */
async function requestInvite<T>(path: string, method: string, dataSchema: z.ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const schema = z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({ success: z.literal(false), error: z.string() }),
  ]);
  const json = schema.parse(await res.json());
  if (!json.success) throw new Error(json.error);
  if (!res.ok) throw new Error(`邀请请求失败（${res.status}）`);
  return json.data;
}

export default function InvitesPanel() {
  const [invites, setInvites] = useState<InvitePublic[] | null>(null);
  const [maxUses, setMaxUses] = useState("1");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const canCopy = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";

  const load = useCallback(async () => {
    setInvites(await requestInvite("/api/admin/invites", "GET", InvitePublicSchema.array()));
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : "邀请列表加载失败"));
  }, [load]);

  async function generate() {
    if (busy) return;
    const parsed = CreateInviteSchema.safeParse({ label: label.trim() || undefined, maxUses: Number(maxUses) });
    if (!parsed.success) { setError(`邀请人数须为 1 至 ${MAX_INVITE_USES} 的整数，备注最多 64 字`); return; }
    setBusy(true);
    setError(null);
    try {
      const data = await requestInvite("/api/admin/invites", "POST", z.object({ link: z.string().url() }), parsed.data);
      setFreshLink(data.link);
      setCopied(false);
      setCopyError(null);
      setLabel("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "生成失败"); }
    finally { setBusy(false); }
  }

  async function updateInvite(id: string, additionalUses?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestInvite(`/api/admin/invites/${id}${additionalUses === undefined ? "" : "/capacity"}`,
        additionalUses === undefined ? "DELETE" : "POST", InvitePublicSchema, additionalUses === undefined ? undefined : { additionalUses });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "更新失败"); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    if (!freshLink) return;
    setCopied(false);
    setCopyError(null);
    if (!canCopy) {
      linkInput.current?.select();
      return;
    }
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
    } catch {
      setCopyError("复制失败，请选中链接手动复制。");
    }
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-[var(--curb)]">
        一个链接可邀请多人，人数用满后可增加名额；已发出的链接不变。完整链接只在生成时展示一次。
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="备注：发给谁（可选）"
          className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1.5 text-[13px] text-[var(--ink)]"
        />
        <label className="text-[13px] text-[var(--paper)]">邀请人数
          <input aria-label="邀请人数" type="number" min={1} max={MAX_INVITE_USES} step={1} value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)} className="ml-2 w-24 border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1 text-[var(--ink)]" />
        </label>
        <button
          type="button" disabled={busy}
          onClick={() => void generate()}
          className="sb-shadow border-2 border-black bg-[var(--act)] px-3 py-1.5 text-[13px] text-[var(--sky)]"
        >
          生成邀请链接
        </button>
      </div>

      {error ? <p className="mb-3 text-[13px] text-[var(--bad)]">{error}</p> : null}

      {freshLink ? (
        <div className="mb-4 border-2 border-[var(--ok)] bg-[var(--panel)] p-3">
          <input
            ref={linkInput}
            aria-label="邀请链接"
            readOnly
            value={freshLink}
            onClick={(event) => event.currentTarget.select()}
            className="mb-2 w-full border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1 text-[13px] text-[var(--ink)]"
          />
          {!canCopy ? (
            <p className="mb-2 text-[12px] text-[var(--curb)]">当前环境不支持自动复制，请选中链接手动复制。</p>
          ) : null}
          {copyError ? <p role="alert" className="mb-2 text-[12px] text-[var(--bad)]">{copyError}</p> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copyInvite()}
              className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1 text-[12px] text-[var(--ink)]"
            >
              {!canCopy ? "选中链接" : copied ? "已复制" : "复制链接"}
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
        <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b-2 border-[var(--curb)] text-[var(--curb)]">
              <th className="py-1.5 pr-3">备注</th>
              <th className="py-1.5 pr-3">生成时间</th>
              <th className="py-1.5 pr-3">状态</th>
              <th className="py-1.5 pr-3">已用 / 上限 / 剩余</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} className="border-b border-[var(--curb)]">
                <td className="py-1.5 pr-3 text-[var(--paper)]">{inv.label ?? "—"}</td>
                <td className="py-1.5 pr-3 text-[var(--curb)]">
                  {new Date(inv.createdAt).toLocaleDateString("zh-CN")}
                </td>
                <td className="py-1.5 pr-3">
                  <span className={inv.revokedAt !== null ? "text-[var(--bad)]" : "text-[var(--ok)]"}>
                    {({ revoked: "已吊销", exhausted: "已用满", available: "可使用" })[inviteAvailability(inv).status]}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-[var(--paper)]">{inv.usedCount} / {inv.maxUses} / {inviteAvailability(inv).remaining}</td>
                <td className="py-1.5">
                  {inv.revokedAt === null ? (
                    <div className="flex flex-wrap items-center gap-2">
                    <InviteCapacityControl invite={inv} busy={busy} onAdd={(amount) => void updateInvite(inv.id, amount)} />
                    <button
                      type="button"
                      disabled={busy} onClick={() => void updateInvite(inv.id)}
                      className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-0.5 text-[12px] text-[var(--ink)]"
                    >
                      吊销
                    </button></div>
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

/** 每条原链接独立输入新增人数，追加成功不重新生成 token。 */
function InviteCapacityControl({ invite, busy, onAdd }: { invite: InvitePublic; busy: boolean; onAdd: (amount: number) => void }) {
  const [amount, setAmount] = useState("1");
  const available = MAX_INVITE_USES - invite.maxUses;
  const value = Number(amount);
  return (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); onAdd(value); }}>
      <input type="number" aria-label={`增加人数 ${invite.label ?? invite.id}`} min={1} max={available} step={1}
        value={amount} onChange={(e) => setAmount(e.target.value)}
        className="w-20 border-2 border-[var(--curb)] bg-[var(--paper)] px-1 text-[var(--ink)]" />
      <button type="submit" disabled={busy || !Number.isInteger(value) || value < 1 || value > available}
        className="border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-0.5 text-[12px] text-[var(--ink)] disabled:opacity-40">增加名额</button>
    </form>
  );
}
