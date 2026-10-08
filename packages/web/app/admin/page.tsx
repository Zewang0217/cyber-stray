"use client";

import { useState } from "react";
import { useAdmin, type BatchDeletionResult, type UserRow } from "@/hooks/useAdmin";
import type { TenantQuotaOverrides } from "@cyber-stray/shared/quota";
import UsagePanel from "./usage-panel";
import InvitesPanel from "./invites-panel";

/**
 * 维修口（/admin，#170 T2 最后铸）：保功能可用 + 世界底线（直角/14 色/实色影/
 * 像素按钮），无游戏 chrome；桌面宽表格。雾区条目就地不显示。
 * 非管理员（403）显示无权限提示。
 */
export default function AdminPage(): React.ReactElement {
  const { users, admins, error, isAdmin, setPlan, setPetStatus, grantAdmin, revokeAdmin, deleteAccount, batchDeleteAccounts, setQuotaOverrides } =
    useAdmin();
  const [grantSub, setGrantSub] = useState("");
  const [tab, setTab] = useState<"users" | "usage" | "invites">("users");
  // 注销流：勾选集 + 弹窗（单个 / 批量共用，理由必填；批量逐项回显结果）
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<
    { mode: "single"; tenantId: string; tenantName: string } | { mode: "batch" } | null
  >(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteResults, setDeleteResults] = useState<BatchDeletionResult[] | null>(null);
  // 配额覆盖弹窗（空输入 = 清除该项，全空 = 清空回套餐默认）
  const [quotaTarget, setQuotaTarget] = useState<UserRow | null>(null);
  const [quotaLlm, setQuotaLlm] = useState("");
  const [quotaPetgen, setQuotaPetgen] = useState("");
  const [quotaPushes, setQuotaPushes] = useState("");
  const [quotaBusy, setQuotaBusy] = useState(false);

  function toggleSelected(tenantId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      return next;
    });
  }

  function closeDeleteModal(): void {
    setDeleteTarget(null);
    setDeleteReason("");
    setDeleteResults(null);
    setSelected(new Set());
  }

  function openQuotaModal(u: UserRow): void {
    setQuotaTarget(u);
    setQuotaLlm(u.quotaOverrides?.llmBudgetYuan != null ? String(u.quotaOverrides.llmBudgetYuan) : "");
    setQuotaPetgen(u.quotaOverrides?.petgenWeeklyLimit != null ? String(u.quotaOverrides.petgenWeeklyLimit) : "");
    setQuotaPushes(u.quotaOverrides?.pushesPerDay != null ? String(u.quotaOverrides.pushesPerDay) : "");
  }

  async function submitQuotaOverrides(): Promise<void> {
    if (!quotaTarget || quotaBusy) return;
    const overrides: TenantQuotaOverrides = {};
    if (quotaLlm.trim() !== "") overrides.llmBudgetYuan = Number(quotaLlm);
    if (quotaPetgen.trim() !== "") overrides.petgenWeeklyLimit = Number(quotaPetgen);
    if (quotaPushes.trim() !== "") overrides.pushesPerDay = Number(quotaPushes);
    setQuotaBusy(true);
    try {
      const ok = await setQuotaOverrides(
        quotaTarget.tenantId,
        Object.keys(overrides).length > 0 ? overrides : null,
      );
      if (ok) setQuotaTarget(null);
    } finally {
      setQuotaBusy(false);
    }
  }

  async function submitDeletion(): Promise<void> {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      if (deleteTarget.mode === "single") {
        await deleteAccount(deleteTarget.tenantId, deleteReason.trim());
        closeDeleteModal();
      } else {
        const results = await batchDeleteAccounts([...selected], deleteReason.trim());
        if (results) setDeleteResults(results); // 明细留在弹窗逐项回显，关闭时一并清理
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  if (isAdmin === false) {
    return (
      <div className="sb mx-auto max-w-2xl p-6">
        <div className="border-2 border-[var(--bad)] bg-[var(--panel)] p-4">
          <p className="text-[13px] text-[var(--bad)]">无权限：仅管理员（CP_ADMIN_SUBS 白名单）可访问维修口。</p>
        </div>
      </div>
    );
  }

  if (!users) {
    return (
      <div className="sb mx-auto max-w-2xl p-6">
        <p className="text-[13px] text-[var(--curb)]">加载中…</p>
        {error ? <p className="text-[13px] text-[var(--bad)]">{error}</p> : null}
      </div>
    );
  }

  const deletedCount = users.filter((u) => u.deletedAt !== null).length;

  return (
    <div className="sb mx-auto max-w-6xl p-4">
      <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">MAINTENANCE · 维修口</h1>
      <p className="mb-4 text-[13px] text-[var(--curb)]">
        全部用户 · 共 {users.length} 人 · {users.filter((u) => u.petId).length} 只有宠物
        {deletedCount > 0 ? ` · ${deletedCount} 已注销` : ""}
      </p>

      {/* 子面板切换：像素按钮（非游戏 tab chrome） */}
      <div className="mb-4 flex gap-2">
        {([["users", "用户管理"], ["usage", "用量"], ["invites", "邀请"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border-2 px-3 py-1.5 text-[13px] ${tab === id ? "border-[var(--act)] bg-[var(--panel)] text-[var(--act)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "usage" && <UsagePanel />}
      {tab === "invites" && <InvitesPanel />}

      {tab === "users" && (
        <>
          {/* 批量操作栏：勾选后出现 */}
          {selected.size > 0 ? (
            <div className="mb-2 flex items-center gap-3 border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-2 text-[13px]">
              <span className="text-[var(--paper)]">已选 {selected.size} 项</span>
              <button type="button" onClick={() => setDeleteTarget({ mode: "batch" })}
                className="border-2 border-[var(--bad)] px-2 py-1 text-[12px] text-[var(--bad)]">
                批量注销…
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-[var(--curb)] underline">
                清除选择
              </button>
            </div>
          ) : null}

          {/* 用户表：桌面宽表格（维修口无游戏 chrome） */}
          <div className="overflow-x-auto border-2 border-black bg-[var(--panel)] shadow-[5px_5px_0_#000]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b-2 border-black text-left text-[var(--hi)]">
                  <th className="px-3 py-2.5"></th>
                  <th className="px-3 py-2.5">用户</th>
                  <th className="px-3 py-2.5">权益</th>
                  <th className="px-3 py-2.5">宠物</th>
                  <th className="px-3 py-2.5">状态</th>
                  <th className="px-3 py-2.5">游荡/推送</th>
                  <th className="px-3 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const deleted = u.deletedAt !== null;
                  return (
                    <tr key={u.tenantId} className={`border-t border-[var(--street)] ${deleted ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={selected.has(u.tenantId)} disabled={deleted}
                          onChange={() => toggleSelected(u.tenantId)} aria-label={`选择 ${u.tenantName}`} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-[var(--paper)]">{u.tenantName}</div>
                        <div className="font-vt323 text-[14px] text-[var(--curb)]">{u.tenantId.slice(0, 8)}</div>
                        {deleted && u.deletionReason ? (
                          <div className="text-[12px] text-[var(--bad)]" title={u.deletionReason}>
                            已注销（{u.deletionMode === "self" ? "自助" : "管理员"}）：{u.deletionReason}
                          </div>
                        ) : null}
                        {u.quotaOverrides ? (
                          <div className="text-[12px] text-[var(--act)]">配额已覆盖</div>
                        ) : null}
                        {!u.petId ? <div className="text-[12px] text-[var(--curb)]">（无宠物）</div> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {u.mode === "invite_beta" ? (
                          <span className="text-[var(--ok)]">内测 Pro</span>
                        ) : <select
                          value={u.plan}
                          onChange={(e) => void setPlan(u.tenantId, e.target.value as typeof u.plan)}
                          className="border-2 border-[var(--curb)] bg-[var(--sky)] px-1.5 py-1 text-[13px] text-[var(--paper)]"
                        >
                          <option value="free">free</option>
                          <option value="pro">pro</option>
                          <option value="byok">byok</option>
                        </select>}
                      </td>
                      <td className="px-3 py-2.5">
                        {u.petId ? (
                          <div>
                            <div className="text-[var(--paper)]">{u.petName}</div>
                            <div className="text-[12px] text-[var(--curb)]">
                              无聊 {u.petBoredom} / 精力 {u.petEnergy}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--curb)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {deleted ? (
                          <span className="text-[var(--bad)]">已注销</span>
                        ) : (
                          <span className={u.petStatus === "active" ? "text-[var(--ok)]" : "text-[var(--curb)]"}>
                            {u.petStatus ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-vt323 text-[16px]">
                        {u.totalWanders} / {u.totalPushes}
                      </td>
                      <td className="px-3 py-2.5">
                        {deleted ? (
                          <span className="text-[12px] text-[var(--curb)]">—</span>
                        ) : (
                          <div className="flex gap-2">
                            <button type="button" onClick={() => openQuotaModal(u)}
                              className="border-2 border-[var(--act)] px-2 py-1 text-[12px] text-[var(--act)]">
                              配额
                            </button>
                            {u.petId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void setPetStatus(u.tenantId, u.petStatus === "active" ? "paused" : "active")
                                }
                                className={`border-2 px-2 py-1 text-[12px] ${
                                  u.petStatus === "active"
                                    ? "border-[var(--bad)] text-[var(--bad)]"
                                    : "border-[var(--ok)] text-[var(--ok)]"
                                }`}
                              >
                                {u.petStatus === "active" ? "暂停" : "恢复"}
                              </button>
                            ) : null}
                            <button type="button" onClick={() => setDeleteTarget({ mode: "single", tenantId: u.tenantId, tenantName: u.tenantName })}
                              className="border-2 border-[var(--bad)] px-2 py-1 text-[12px] text-[var(--bad)]">
                              注销
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 管理员管理（RBAC）：env 授权不可撤销 */}
          <div className="mt-6 border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
            <h2 className="mb-1 text-[14px] text-[var(--paper)]">管理员</h2>
            <p className="mb-3 text-[12px] leading-[1.7] text-[var(--curb)]">
              管理员可查看用户与运行状态、发放邀请、授权他人。邀请内测期间，所有账号统一享有 Pro 权益。
              管理员账号不可被注销（防锁死管理面）。
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {admins?.map((a) => (
                <span key={a.sub} className="flex items-center gap-2 border border-[var(--curb)] px-2 py-1 text-[12px] text-[var(--paper)]">
                  <span className="font-vt323 text-[14px]">{a.sub.slice(0, 12)}</span>
                  <span className="text-[var(--curb)]">{a.grantedBy === "env" ? "(env)" : `由 ${a.grantedBy.slice(0, 8)} 授予`}</span>
                  {a.grantedBy !== "env" ? (
                    <button type="button" onClick={() => void revokeAdmin(a.sub)} className="text-[var(--bad)] underline">撤销</button>
                  ) : null}
                </span>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault();
              if (grantSub.trim()) void grantAdmin(grantSub.trim());
              setGrantSub("");
            }}>
              <input
                value={grantSub}
                onChange={(e) => setGrantSub(e.target.value)}
                placeholder="输入用户 sub（Casdoor）授予管理员"
                className="flex-1 border-2 border-[var(--curb)] bg-[var(--sky)] px-3 py-2 font-vt323 text-[16px] text-[var(--paper)]"
              />
              <button type="submit" className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 text-[13px] text-[var(--paper)]">
                授权
              </button>
            </form>
            {error ? <p className="mt-2 text-[13px] text-[var(--bad)]">{error}</p> : null}
          </div>

          {/* 注销弹窗：单个 / 批量共用；理由必填留档，批量逐项回显结果 */}
          {deleteTarget ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
              <div className="w-full max-w-md border-4 border-black bg-[var(--panel)] p-4 shadow-[8px_8px_0_#000]">
                <h2 className="font-ps2p mb-2 text-xs text-[var(--bad)]">ACCOUNT DELETION · 注销账户</h2>
                {deleteResults ? (
                  <>
                    <p className="mb-3 text-[13px] text-[var(--paper)]">
                      批量注销完成：成功 {deleteResults.filter((r) => r.ok).length} · 失败 {deleteResults.filter((r) => !r.ok).length}
                    </p>
                    <ul className="mb-3 max-h-64 overflow-y-auto text-[12px] leading-[1.8]">
                      {deleteResults.map((r) => (
                        <li key={r.tenantId}>
                          <span className={r.ok ? "text-[var(--ok)]" : "text-[var(--bad)]"}>{r.ok ? "OK" : "ERR"}</span>{" "}
                          <span className="font-vt323 text-[14px] text-[var(--paper)]">{r.tenantId.slice(0, 12)}</span>
                          {!r.ok ? <span className="text-[var(--bad)]"> — {r.error}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={closeDeleteModal} className="border-2 border-[var(--curb)] px-3 py-1.5 text-[13px] text-[var(--paper)]">
                      关闭
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mb-3 text-[13px] leading-[1.8] text-[var(--paper)]">
                      {deleteTarget.mode === "single"
                        ? `确认注销「${deleteTarget.tenantName}」？宠物将永久停止探索，账号停用；理由必填留档。`
                        : `确认批量注销 ${selected.size} 个账号？宠物将永久停止探索；理由必填留档。`}
                    </p>
                    <textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}
                      aria-label="注销理由（必填）" rows={3}
                      placeholder="注销理由（必填，留档审计）"
                      className="mb-3 w-full border-2 border-[var(--bad)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void submitDeletion()} disabled={deleteBusy || !deleteReason.trim()}
                        className="border-2 border-[var(--bad)] px-3 py-1.5 text-[13px] text-[var(--bad)] disabled:opacity-50">
                        {deleteBusy ? "注销中…" : "确认注销"}
                      </button>
                      <button type="button" onClick={closeDeleteModal} className="border-2 border-[var(--curb)] px-3 py-1.5 text-[13px] text-[var(--paper)]">
                        取消
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {/* 配额覆盖弹窗：空输入 = 清除该项；全空 = 清空回套餐默认；0 = 不限 */}
          {quotaTarget ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
              <div className="w-full max-w-md border-4 border-black bg-[var(--panel)] p-4 shadow-[8px_8px_0_#000]">
                <h2 className="font-ps2p mb-2 text-xs text-[var(--act)]">QUOTA · 配额覆盖</h2>
                <p className="mb-3 text-[13px] leading-[1.8] text-[var(--paper)]">
                  「{quotaTarget.tenantName}」的租户级配额。留空 = 跟随套餐默认；0 = 不限；
                  保存后 LLM 预算与外观额度下个调度周期生效，推送上限下轮游荡生效。
                </p>
                <div className="mb-3 flex flex-col gap-2 text-[13px]">
                  <label className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-[var(--curb)]">LLM 日预算（¥）</span>
                    <input value={quotaLlm} onChange={(e) => setQuotaLlm(e.target.value)} inputMode="decimal"
                      placeholder="默认（free 0.5 / pro 2）"
                      className="flex-1 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]" />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-[var(--curb)]">外观七天套数</span>
                    <input value={quotaPetgen} onChange={(e) => setQuotaPetgen(e.target.value)} inputMode="numeric"
                      placeholder="默认 1"
                      className="flex-1 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]" />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-[var(--curb)]">每日推送上限</span>
                    <input value={quotaPushes} onChange={(e) => setQuotaPushes(e.target.value)} inputMode="numeric"
                      placeholder="默认（free 5 / pro 20）"
                      className="flex-1 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]" />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void submitQuotaOverrides()} disabled={quotaBusy}
                    className="border-2 border-[var(--act)] px-3 py-1.5 text-[13px] text-[var(--act)] disabled:opacity-50">
                    {quotaBusy ? "保存中…" : "保存"}
                  </button>
                  <button type="button" onClick={() => setQuotaTarget(null)} className="border-2 border-[var(--curb)] px-3 py-1.5 text-[13px] text-[var(--paper)]">
                    取消
                  </button>
                </div>
                {error ? <p className="mt-2 text-[13px] text-[var(--bad)]">{error}</p> : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
