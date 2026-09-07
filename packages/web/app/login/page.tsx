import type { Metadata } from "next";
import { BootFrame } from "@/components/strayboy/BootFrame";

/**
 * 登录页（#170 T2 / 票 #195）：box-art 母题——一台未通电的 STRAY-BOY，
 * 电源键 = 登录（发起 Casdoor 认证 302，IdP 流不变）。
 * 前置核查结论：Casdoor 密码流（表单直连认证 API）在本机不可达未验证，
 * 首选降级为像素壳 + 302（像素壳仍自建，视觉不跳出世界）；
 * 密码流可用后可换表单直连（规格见 spec Decision 4）。
 */
export const metadata: Metadata = {
  title: "登录 · STRAY-BOY",
};

export default function LoginPage() {
  return (
    <div className="sb flex min-h-screen flex-col items-center justify-center bg-[var(--sky)] p-6">
      <BootFrame />
      {/* 未通电掌机：屏幕熄灭（暗 panel）+ 机身铭牌 */}
      <div className="w-full max-w-xs border-4 border-black bg-[var(--panel)] p-5 shadow-[8px_8px_0_#000]">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-ps2p text-xs text-[var(--paper)]">STRAY-BOY</span>
          <span aria-hidden className="inline-block h-2.5 w-2.5 bg-[var(--window-off)]" />
        </div>
        {/* 熄灭的屏幕 */}
        <div className="mb-5 flex h-40 items-center justify-center border-2 border-black bg-[var(--window-off)]">
          <p className="font-vt323 text-[20px] text-[var(--street)]">NO SIGNAL</p>
        </div>
        {/* 电源键 = 登录（Casdoor 302；IdP 页由 Casdoor 呈现） */}
        <a
          href="/api/auth/login"
          aria-label="按电源键开机登录"
          className="flex w-full items-center justify-center gap-3 border-2 border-black bg-[var(--panel)] px-4 py-3 shadow-[3px_3px_0_#000] hover:border-[var(--ok)]"
        >
          <span aria-hidden className="inline-block h-3 w-3 rounded-full border-2 border-[var(--ok)]" />
          <span className="font-ps2p text-xs text-[var(--ok)]">POWER ON · 登录</span>
        </a>
        <p className="mt-4 text-center text-[12px] leading-[1.7] text-[var(--curb)]">
          通电即进入像素夜城。
          <br />
          认证由 Casdoor 提供（点击后跳转授权页）。
        </p>
      </div>
    </div>
  );
}
