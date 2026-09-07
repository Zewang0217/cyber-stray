"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useWechatBind } from "@/hooks/useWechatBind";

/**
 * 微信通道（#97 → #170 T2 街机招贴）：公开页（免登录），扫码即用。
 * 流程：街机招贴（掌机大图 + 三步指引）→ 二维码（腾讯 liteapp JS 页，须 iframe）
 * → 等待/确认 → 配对成功。支持 ?rebind=<tenantId>（重新激活，白名单防抢绑）。
 * 皮肤 = 街机招贴：像素设备框 + 黄色招贴字，旧世界动效（framer-motion/spring）移除，只留 steps。
 */
function WechatInner() {
  const searchParams = useSearchParams();
  const rebind = searchParams.get("rebind") ?? undefined;
  const { phase, qrcodeImgUrl, error, result, start, reset } = useWechatBind();

  const startBinding = (): void => void start(rebind);

  return (
    <div className="sb min-h-screen bg-[var(--sky)] p-6">
      <div className="mx-auto max-w-md">
        <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">ARCADE · 微信通道</h1>
        <p className="mb-6 text-[13px] leading-[1.7] text-[var(--curb)]">
          {phase === "confirmed" && result
            ? "配对成功。"
            : phase === "expired" || phase === "error"
              ? "出问题了。"
              : rebind
                ? "微信通道已过期。重新扫码后即可激活。"
                : "扫码即用：把它接进你的微信。"}
        </p>

        {phase === "confirmed" && result ? (
          <div className="border-4 border-[var(--ink)] bg-[var(--paper)] p-6 shadow-[6px_6px_0_#000]">
            <p className="font-ps2p mb-3 text-xs text-[var(--ok)]">PAIRED · 配对成功</p>
            <h2 className="mb-3 text-[16px] text-[var(--ink)]">它住进你的微信了！</h2>
            <p className="font-noto mb-4 text-[13.5px] leading-[1.75] text-[#4A4238]">
              {result.created
                ? `已为你创建赛博宠物「${result.petName}」（免费档起步）。`
                : `已重新激活「${result.petName}」。`}
              现在打开微信，给它发条消息——之后就能随时聊天、收到它的新发现。
            </p>
            <div className="mb-4 border-2 border-[var(--curb)] bg-[var(--sky)] p-2.5 text-[12px] leading-[1.7] text-[var(--paper)]">
              提示：激活前宠物不会推送内容；超过 24 小时没聊天，通道会暂停，发条消息即可重新激活。
            </div>
            <Link href="/" className="block border-2 border-black bg-[var(--act)] px-4 py-2.5 text-center text-[13px] text-[var(--sky)] shadow-[3px_3px_0_#000]">
              去看它 ▶
            </Link>
          </div>
        ) : phase === "expired" || phase === "error" ? (
          <div className="border-4 border-[var(--ink)] bg-[var(--paper)] p-6 shadow-[6px_6px_0_#000]">
            <p className="font-ps2p mb-3 text-xs text-[var(--bad)]">
              {phase === "expired" ? "EXPIRED · 已过期" : "FAILED · 绑定失败"}
            </p>
            <p className="font-noto mb-5 text-[13.5px] leading-[1.75] text-[var(--ink)]">{error}</p>
            <button
              type="button"
              onClick={reset}
              className="w-full border-2 border-black bg-[var(--act)] px-4 py-2.5 text-[13px] text-[var(--sky)] shadow-[3px_3px_0_#000]"
            >
              重新发起绑定
            </button>
          </div>
        ) : phase === "waiting" || phase === "scaned" ? (
          <div className="border-4 border-[var(--ink)] bg-[var(--paper)] p-6 shadow-[6px_6px_0_#000]">
            <p className="font-ps2p mb-3 text-xs text-[var(--ink)]">
              {rebind ? "RE-PAIR · 重新激活" : "PAIRING · 扫码绑定"}
            </p>
            <h2 className="mb-4 text-[16px] text-[var(--ink)]">
              {phase === "scaned" ? "已扫码，请在手机上确认" : "用微信扫一扫"}
            </h2>
            <p className="font-noto mb-4 text-[13px] leading-[1.75] text-[#4A4238]">
              {phase === "scaned" ? "手机微信上确认后，配对即刻完成。" : "扫码后自动建租户并领养一只宠物（免费档），无需注册。"}
            </p>
            {qrcodeImgUrl ? (
              <div className="mb-4 flex justify-center">
                <div className="border-4 border-[var(--ink)] bg-white p-2 shadow-[5px_5px_0_#000]">
                  {/* qrcodeImgUrl 是腾讯 liteapp 的 JS 渲染页面（非图片），须 iframe 嵌入；
                      直接 <img> 会因 content-type=text/html 破图不显示 */}
                  <iframe
                    src={qrcodeImgUrl}
                    title="微信扫码绑定二维码"
                    width={224}
                    height={224}
                    className="pixelated"
                  />
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-center gap-2 text-[13px] text-[var(--curb)]">
              <span aria-hidden className={`h-2 w-2 bg-[var(--ok)] ${phase === "scaned" ? "" : "sb-blink"}`} />
              等待{phase === "scaned" ? "手机确认" : "扫码"}…
            </div>
          </div>
        ) : (
          <div className="border-4 border-[var(--ink)] bg-[var(--paper)] p-6 shadow-[6px_6px_0_#000]">
            <p className="font-ps2p mb-3 text-xs text-[var(--ink)]">WECHAT · 微信通道</p>
            <h2 className="mb-3 text-[16px] text-[var(--ink)]">
              {rebind ? "重新激活微信通道" : "把宠物接进微信"}
            </h2>
            <p className="font-noto mb-5 text-[13.5px] leading-[1.75] text-[#4A4238]">
              {rebind
                ? "微信通道已过期。重新扫码后，发条消息即可再次激活。"
                : "扫码即用：绑定后它会出现在你的微信聊天框，可以随时聊天，也能收到它探索世界的新发现。"}
            </p>
            <div className="mb-6 space-y-1.5 text-[13px] leading-[1.7] text-[#4A4238]">
              <p>1. 点击下方按钮生成二维码</p>
              <p>2. 用微信「扫一扫」扫描</p>
              <p>3. 在手机上确认配对</p>
            </div>
            <button
              type="button"
              onClick={startBinding}
              disabled={phase === "starting"}
              className="w-full border-2 border-black bg-[var(--act)] px-4 py-3 font-ps2p text-xs text-[var(--sky)] shadow-[3px_3px_0_#000] disabled:opacity-50"
            >
              {phase === "starting" ? "生成中…" : "生成二维码"}
            </button>
          </div>
        )}

        <p className="mt-6 text-center">
          <Link href="/" className="text-[13px] text-[var(--curb)] underline">◀ 回到掌机</Link>
        </p>
      </div>
    </div>
  );
}

export default function WechatPage() {
  return (
    <Suspense>
      <WechatInner />
    </Suspense>
  );
}
