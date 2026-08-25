"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWechatBind } from "@/hooks/useWechatBind";

/**
 * 微信通道绑定页（#97）：扫码即用（公开页，无需登录）。
 *
 * 流程：展示二维码 → 等待扫码 → 确认配对 → 自动建租户 + 领养宠物（免费档）
 * 错误分支明确反馈：超时 / 他人扫码 / 验证码受限 / 绑定会话失效。
 * 支持 ?rebind=<tenantId>（设置页"重新激活"入口；pairing 白名单校验防抢绑）。
 */
function WechatBindPageInner(): React.ReactElement {
  const searchParams = useSearchParams();
  const rebind = searchParams.get("rebind") ?? undefined;
  const { phase, qrcodeImgUrl, error, result, start, reset } = useWechatBind();

  const startBinding = () => void start(rebind);

  return (
    <div className="spacing-lg flex items-center justify-center min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="w-full max-w-md"
      >
        <AnimatePresence mode="wait">
          {phase === "confirmed" && result ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="paper-card p-8 rounded-sm"
            >
              <p className="field-note text-sm text-subtext mb-2">Paired · 配对成功</p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-4">
                它住进你的微信了!
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                {result.created
                  ? `已为你创建赛博宠物「${result.petName}」(免费档起步)。`
                  : `已重新激活「${result.petName}」。`}
                现在打开微信,给它发条消息——它会先跟你打招呼,之后就能随时聊天、
                收到它探索世界的新发现。
              </p>
              <div className="p-3 rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)] text-small text-subtext mb-6">
                提示:激活前宠物不会推送内容;超过 24 小时没聊天,通道会暂停,
                发条消息就能重新激活。
              </div>
              <Link
                href="/"
                className="block w-full py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium text-center hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all"
              >
                去看它
              </Link>
            </motion.div>
          ) : phase === "expired" || phase === "error" ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="paper-card p-8 rounded-sm"
            >
              <p className="field-note text-sm text-[var(--c-state-warn)] mb-2">
                {phase === "expired" ? "Expired · 已过期" : "Failed · 绑定失败"}
              </p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-4">
                {phase === "expired" ? "二维码过期了" : "出了点问题"}
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">{error}</p>
              <button
                onClick={reset}
                className="w-full py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all"
              >
                重新发起绑定
              </button>
            </motion.div>
          ) : phase === "waiting" || phase === "scaned" ? (
            <motion.div
              key="qr"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="paper-card p-8 rounded-sm"
            >
              <p className="field-note text-sm text-subtext mb-2">
                {rebind ? "Re-pair · 重新激活" : "Pairing · 扫码绑定"}
              </p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-4">
                {phase === "scaned" ? "已扫码,请在手机上确认" : "用微信扫一扫"}
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                {phase === "scaned"
                  ? "手机微信上确认后,配对即刻完成。"
                  : "扫码后它会自动为你创建租户并领养一只赛博宠物(免费档),无需注册。"}
              </p>
              {qrcodeImgUrl ? (
                <div className="flex justify-center mb-6">
                  {/* qrcodeImgUrl 是腾讯 liteapp 的 JS 渲染页面（非图片），须 iframe 嵌入；
                      直接 <img> 会因 content-type=text/html 破图不显示 */}
                  <iframe
                    src={qrcodeImgUrl}
                    title="微信扫码绑定二维码"
                    width={260}
                    height={260}
                    className="rounded-sm border border-[var(--c-engraving-fine)]"
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-center gap-2 text-small text-subtext">
                <span className={`inline-block w-2 h-2 rounded-full bg-[var(--c-amber)] ${phase === "scaned" ? "" : "animate-pulse"}`} />
                等待{phase === "scaned" ? "手机确认" : "扫码"}…
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="paper-card p-8 rounded-sm"
            >
              <p className="field-note text-sm text-subtext mb-2">WeChat · 微信通道</p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-4">
                {rebind ? "重新激活微信通道" : "把宠物接进微信"}
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                {rebind
                  ? "微信通道已过期。重新扫码后,发条消息即可再次激活。"
                  : "扫码即用:绑定后它会出现在你的微信聊天框,可以随时聊天,也能收到它探索世界的新发现。"}
              </p>
              <div className="space-y-2 text-small text-subtext mb-6">
                <p>1. 点击下方按钮生成二维码</p>
                <p>2. 用微信「扫一扫」扫描</p>
                <p>3. 在手机上确认配对</p>
              </div>
              <button
                onClick={startBinding}
                disabled={phase === "starting"}
                className="w-full py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all disabled:opacity-50"
              >
                {phase === "starting" ? "生成中…" : "生成二维码"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default function WechatBindPage(): React.ReactElement {
  return (
    <Suspense>
      <WechatBindPageInner />
    </Suspense>
  );
}
