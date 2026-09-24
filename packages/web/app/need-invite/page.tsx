import type { Metadata } from "next";

/**
 * 需邀请页（#301）：注册面收口后，无有效邀请的登录者落这里。
 * 不暴露「如何获得邀请」的操作指引——内测邀请是熟人分发。
 */
export const metadata: Metadata = {
  title: "需要邀请函 · STRAY-BOY",
};

export default function NeedInvitePage() {
  return (
    <div className="sb flex min-h-screen flex-col items-center justify-center bg-[var(--sky)] p-6">
      <div className="w-full max-w-xs border-4 border-black bg-[var(--panel)] p-5 shadow-[8px_8px_0_#000]">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-ps2p text-xs text-[var(--paper)]">STRAY-BOY</span>
          <span aria-hidden className="inline-block h-2.5 w-2.5 bg-[var(--window-off)]" />
        </div>
        <div className="mb-5 flex h-40 items-center justify-center border-2 border-black bg-[var(--window-off)]">
          <p className="font-vt323 text-[20px] text-[var(--street)]">INVITE ONLY</p>
        </div>
        <p className="text-center text-[12px] leading-[1.7] text-[var(--curb)]">
          这座像素夜城还在内测。
          <br />
          需要一张邀请函才能放你的街溜子出门。
        </p>
      </div>
    </div>
  );
}
