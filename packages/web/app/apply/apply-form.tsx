"use client";

import { useState, type FormEvent } from "react";
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from "@cyber-stray/shared/invite-application";

/**
 * 申请表单 + 凭据对保管提醒 + 查询取码。三态互斥展示：
 * 提交成功只此一次展示查询码；查询结果 approved 时给邀请链接直达。
 */
export function ApplyForm() {
  const [nickname, setNickname] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 提交成功后当场展示的凭据对（查询码只此一次，刷新即逝）
  const [credentials, setCredentials] = useState<{ applicationId: string; secret: string } | null>(null);

  // 查询面
  const [queryId, setQueryId] = useState("");
  const [querySecret, setQuerySecret] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: ApplicationStatus; inviteUrl?: string } | null>(null);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
          reason: reason.trim(),
        }),
      });
      const json = (await res.json()) as { success: boolean; data?: { applicationId: string; secret: string }; error?: string };
      if (!json.success || !json.data) throw new Error(json.error ?? "提交失败");
      setCredentials(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setBusy(false);
    }
  };

  const onQuery = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setQueryBusy(true);
    setQueryError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/apply/status?id=${encodeURIComponent(queryId.trim())}&secret=${encodeURIComponent(querySecret.trim())}`);
      const json = (await res.json()) as { success: boolean; data?: { status: ApplicationStatus; inviteUrl?: string }; error?: string };
      if (!json.success || !json.data) throw new Error(json.error ?? "查询失败");
      setResult(json.data);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setQueryBusy(false);
    }
  };

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板权限被拒时静默：凭据对已全文展示，手动抄录也可
    }
  };

  return (
    <div className="w-full max-w-md">
      <header className="mb-4 mt-6 flex items-baseline justify-between">
        <h1 className="font-ps2p text-xs text-[var(--hi)]">APPLY · 申请邀请函</h1>
        <a href="/login" className="text-[13px] text-[var(--act)] underline">已有账号</a>
      </header>

      <section className="mb-5 border-4 border-black bg-[var(--panel)] p-4 shadow-[6px_6px_0_#000]">
        <p className="text-[14px] leading-[1.8] text-[var(--paper)]">
          这座像素夜城还在内测，进街需要一张邀请函。
        </p>
        <p className="mt-2 text-[13px] leading-[1.8] text-[var(--curb)]">
          申请不填邮箱、手机号或任何密钥。提交后当场发你一对「申请号 + 查询码」——
          <b className="text-[var(--hi)]">这是唯一的取件凭据，请自己抄好</b>。批准后凭它回到这页取邀请链接。
        </p>
      </section>

      {credentials ? (
        <section className="mb-5 border-4 border-[var(--ink)] bg-[var(--paper)] p-4 shadow-[6px_6px_0_#000]">
          <h2 className="mb-2 font-ps2p text-xs text-[var(--ink)]">申请已递出</h2>
          <p className="mb-3 text-[13px] leading-[1.8] text-[var(--ink-soft)]">
            查询码只显示这一次（我们不留明文）。抄好或截图，丢了就只能重新申请。
          </p>
          <dl className="mb-3 space-y-2 border-2 border-dashed border-[var(--curb)] p-3 font-vt323 text-[18px] text-[var(--ink)]">
            <div className="flex items-center justify-between gap-2">
              <dt className="font-noto text-[13px] text-[var(--curb)]">申请号</dt>
              <dd className="flex items-center gap-2">
                <span className="truncate">{credentials.applicationId}</span>
                <button type="button" onClick={() => void copy(credentials.applicationId)}
                  className="border-2 border-[var(--ink)] bg-[var(--hi)] px-2 py-0.5 font-noto text-[12px]">
                  复制
                </button>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="font-noto text-[13px] text-[var(--curb)]">查询码</dt>
              <dd className="flex items-center gap-2">
                <span className="truncate">{credentials.secret}</span>
                <button type="button" onClick={() => void copy(credentials.secret)}
                  className="border-2 border-[var(--ink)] bg-[var(--hi)] px-2 py-0.5 font-noto text-[12px]">
                  复制
                </button>
              </dd>
            </div>
          </dl>
          <button type="button" onClick={() => { setQueryId(credentials.applicationId); setQuerySecret(credentials.secret); }}
            className="border-2 border-[var(--ink)] bg-[var(--panel)] px-3 py-1.5 text-[13px] text-[var(--paper)]">
            帮我填进下面的查询框 →
          </button>
        </section>
      ) : (
        <form onSubmit={onSubmit} className="mb-5 border-4 border-black bg-[var(--panel)] p-4 shadow-[6px_6px_0_#000]">
          <label className="mb-1 block font-noto text-[13px] text-[var(--paper)]" htmlFor="apply-nickname">
            怎么称呼你（可不填）
          </label>
          <input
            id="apply-nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={32}
            autoComplete="off"
            className="mb-4 w-full border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1.5 font-noto text-[14px] text-[var(--ink)]"
          />
          <label className="mb-1 block font-noto text-[13px] text-[var(--paper)]" htmlFor="apply-reason">
            想让街溜子帮你盯点什么？（8 到 500 字）
          </label>
          <textarea
            id="apply-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={4}
            required
            className="mb-1 w-full resize-none border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1.5 font-noto text-[14px] leading-[1.7] text-[var(--ink)]"
          />
          <p className="mb-3 text-right font-vt323 text-[16px] text-[var(--curb)]">{reason.trim().length}/500</p>
          {error && <p className="mb-3 border-2 border-[var(--bad)] p-2 text-[13px] text-[var(--bad)]">{error}</p>}
          <button
            type="submit"
            disabled={busy || reason.trim().length < 8}
            className="w-full border-2 border-[var(--ink)] bg-[var(--hi)] px-3 py-2 font-noto text-[15px] font-bold text-[var(--ink)] shadow-[2px_2px_0_#000] transition-none active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-50 disabled:shadow-none"
          >
            {busy ? "递信中……" : "递出申请"}
          </button>
        </form>
      )}

      <section className="border-4 border-black bg-[var(--panel)] p-4 shadow-[6px_6px_0_#000]">
        <h2 className="mb-3 font-ps2p text-xs text-[var(--paper)]">查询 · 取邀请函</h2>
        <form onSubmit={onQuery} className="space-y-3">
          <div>
            <label className="mb-1 block font-noto text-[13px] text-[var(--paper)]" htmlFor="query-id">申请号</label>
            <input id="query-id" value={queryId} onChange={(e) => setQueryId(e.target.value)} required
              className="w-full border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1.5 font-vt323 text-[18px] text-[var(--ink)]" />
          </div>
          <div>
            <label className="mb-1 block font-noto text-[13px] text-[var(--paper)]" htmlFor="query-secret">查询码</label>
            <input id="query-secret" value={querySecret} onChange={(e) => setQuerySecret(e.target.value)} required
              className="w-full border-2 border-[var(--curb)] bg-[var(--paper)] px-2 py-1.5 font-vt323 text-[18px] text-[var(--ink)]" />
          </div>
          {queryError && <p className="border-2 border-[var(--bad)] p-2 text-[13px] text-[var(--bad)]">{queryError}</p>}
          <button type="submit" disabled={queryBusy}
            className="w-full border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-2 font-noto text-[14px] text-[var(--paper)] disabled:opacity-50">
            {queryBusy ? "翻信箱……" : "查一查"}
          </button>
        </form>
        {result && (
          <div className="mt-4 border-t-2 border-[var(--street)] pt-3">
            {result.status === "approved" && result.inviteUrl ? (
              <>
                <p className="mb-2 text-[14px] text-[var(--hi)]">批了！你的邀请函在这里：</p>
                <a href={result.inviteUrl}
                  className="block border-2 border-[var(--ink)] bg-[var(--hi)] px-3 py-2 text-center font-noto text-[15px] font-bold text-[var(--ink)] shadow-[2px_2px_0_#000] transition-none active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                  打开邀请函，进街 →
                </a>
              </>
            ) : result.status === "rejected" ? (
              <p className="text-[14px] leading-[1.8] text-[var(--paper)]">
                这封申请被回绝了。内测名额有限，不代表下封也会被拒——换个理由再递一封试试。
              </p>
            ) : (
              <p className="text-[14px] leading-[1.8] text-[var(--paper)]">
                状态：<b className="text-[var(--hi)]">{APPLICATION_STATUS_LABELS[result.status]}</b>。城主看到会处理的，过两天再来查。
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
