"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { useWebPush } from "@/hooks/useWebPush";
import { useChannels } from "@/hooks/useChannels";
import { usePlan } from "@/hooks/usePlan";
import { useWechatStatus } from "@/hooks/useWechatStatus";
import { usePets } from "@/hooks/usePets";
import { CatchphraseEditor } from "@/components/dashboard/CatchphraseEditor";

/**
 * 设置页面
 * 只读展示当前配置，提示修改需编辑后端 .env 文件
 */
export default function SettingsPage(): React.ReactElement {
  const { state: pushState, error: pushError, enable, disable } = useWebPush();
  const { channels, bindFeishu, unbindFeishu, error: channelError } = useChannels();
  const {
    plan,
    error: planError,
    switchPlan,
    setPushWindow,
    clearPushWindow,
    bindByokKey,
  } = usePlan();
  const { status: wechatStatus } = useWechatStatus();
  const [sleepSaved, setSleepSaved] = useState(false);
  const { pets, setSleepSchedule, clearSleepSchedule, setDiaryStyle, setDiaryPush, setCatchphrases, error: petsError } = usePets();
  const sleepPet = pets[0] ?? null;
  const hasSleepSchedule =
    sleepPet !== null && sleepPet.sleepStart !== null && sleepPet.sleepEnd !== null;
  return (
    <div className="spacing-lg max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <h1
          className="font-heading text-hero font-semibold text-text"
          style={{ letterSpacing: "-0.04em" }}
        >
          设置
        </h1>
        <p className="text-body text-subtext mt-1">
          查看当前 Agent 配置（修改需编辑后端 .env 文件）
        </p>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25, delay: 0.1 }}
      >
        {/* 心跳配置 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-4">
            心跳与状态
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">心跳间隔</span>
              <span className="text-text">5 分钟</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">无聊增长速率</span>
              <span className="text-text">+5 / 心跳</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">精力恢复速率</span>
              <span className="text-text">+2 / 心跳</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">无聊阈值</span>
              <span className="text-text">50</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">精力阈值</span>
              <span className="text-text">20</span>
            </div>
          </div>
        </div>

        {/* LLM 配置 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-4">
            LLM 配置
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">模型</span>
              <span className="text-text">deepseek-chat</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">Temperature</span>
              <span className="text-text">0.8</span>
            </div>
          </div>
        </div>

        {/* 搜索配置 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-4">
            搜索配置
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">最大结果数</span>
              <span className="text-text">10</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">搜索 API</span>
              <span className="text-text">Tavily</span>
            </div>
          </div>
        </div>

        {/* 推送配置 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-4">
            推送渠道
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between items-center">
              <span className="text-subtext">飞书 Webhook</span>
              <span className="text-success text-xs">已配置</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-subtext">Telegram Bot</span>
              <span className="text-subtext text-xs">未配置</span>
            </div>
          </div>
        </div>

        {/* 系统推送（S10）：Web Push 订阅开关 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-2">系统推送</h2>
          <p className="text-small text-subtext mb-4">
            关掉 App 也能收到它的推送（浏览器系统级通知）
          </p>
          {pushState === "unsupported" ? (
            <p className="text-small text-subtext">当前浏览器不支持系统推送</p>
          ) : pushState === "denied" ? (
            <p className="text-small text-danger">
              通知权限被拒绝——请在浏览器站点设置中允许通知后重试
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pushState === "subscribing"}
                onClick={() => void (pushState === "on" ? disable() : enable())}
                className={`px-4 py-2 rounded-sm text-small font-medium transition-colors ${
                  pushState === "on"
                    ? "bg-success/20 text-success"
                    : "bg-accent text-base font-semibold"
                } disabled:opacity-50`}
              >
                {pushState === "subscribing"
                  ? "订阅中…"
                  : pushState === "on"
                    ? "已开启（点击关闭）"
                    : "开启系统推送"}
              </button>
              {pushError ? <span className="text-small text-danger">{pushError}</span> : null}
            </div>
          )}
        </div>

        {/* 飞书通道（S10）：可选绑定 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-2">飞书通道（可选）</h2>
          <p className="text-small text-subtext mb-4">
            绑定后推送同步发到飞书群机器人（高级用户）
          </p>
          {channels?.feishu ? (
            <div className="flex items-center gap-3">
              <span className="text-small text-success">已绑定</span>
              <button
                type="button"
                onClick={() => void unbindFeishu()}
                className="px-3 py-1.5 rounded-sm text-small bg-danger/10 text-danger"
              >
                解绑
              </button>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const webhook = new FormData(form).get("webhook");
                if (typeof webhook === "string") void bindFeishu(webhook);
                form.reset();
              }}
            >
              <input
                name="webhook"
                type="url"
                required
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
                className="flex-1 px-3 py-2 rounded-sm bg-surface text-small text-text border border-[var(--c-engraving-fine)]"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-sm text-small bg-accent text-base font-semibold"
              >
                绑定
              </button>
            </form>
          )}
          {channelError ? <p className="text-small text-danger mt-2">{channelError}</p> : null}
        </div>

        {/* 微信通道（#97）：扫码即用 + 过期提示 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-2">
            微信通道（可选）
          </h2>
          <p className="text-small text-subtext mb-4">
            扫码绑定后可在微信里和宠物聊天（双向 DM + 每日受限推送）
          </p>
          {!wechatStatus ? (
            <p className="text-small text-subtext">加载中…</p>
          ) : !wechatStatus.bound ? (
            <a
              href="/wechat"
              className="inline-block px-4 py-2 rounded-sm text-small bg-accent text-base font-semibold"
            >
              扫码绑定
            </a>
          ) : wechatStatus.status === "expired" ? (
            <div className="flex items-center gap-3">
              <span className="text-small text-danger">
                {wechatStatus.expiredHint ?? "微信通道已过期,发条消息重新激活"}
              </span>
              <a
                href={`/wechat?rebind=${encodeURIComponent(wechatStatus.tenantId ?? "")}`}
                className="px-3 py-1.5 rounded-sm text-small bg-accent text-base font-semibold"
              >
                重新激活
              </a>
            </div>
          ) : (
            <span className="text-small text-success">
              已绑定（{wechatStatus.status === "active" ? "活跃中" : "等待激活"}）——
              在微信里给宠物发条消息开始聊天
            </span>
          )}
        </div>

        {/* 套餐（S11）：Plan 门控与节流 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-2">套餐</h2>
          <p className="text-small text-subtext mb-4">
            {plan
              ? `当前 ${plan.plan.toUpperCase()} · 每日推送上限 ${plan.limits.pushesPerDay} 条`
              : "加载中…"}
            。宠物自进化永不设限，套餐只卡「到达主人」的频率。
          </p>
          <div className="flex gap-2 mb-4">
            {(["free", "pro", "byok"] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={plan?.plan === p}
                onClick={() => void switchPlan(p)}
                className={`px-4 py-2 rounded-sm text-small font-semibold ${
                  plan?.plan === p
                    ? "bg-accent text-base"
                    : "bg-surface text-subtext border border-[var(--c-engraving-fine)]"
                }`}
              >
                {p === "free" ? "免费" : p === "pro" ? "Pro" : "BYOK"}
              </button>
            ))}
          </div>

          {/* 推送窗口（Pro/BYOK） */}
          {plan && plan.plan !== "free" ? (
            <form
              className="flex gap-2 items-center mb-3"
              onSubmit={(e) => {
                e.preventDefault();
                const s = Number(new FormData(e.currentTarget).get("start"));
                const en = Number(new FormData(e.currentTarget).get("end"));
                if (Number.isInteger(s) && Number.isInteger(en)) void setPushWindow(s, en);
              }}
            >
              <span className="text-small text-subtext">推送时间</span>
              <input
                name="start"
                type="number"
                min={0}
                max={23}
                defaultValue={plan.pushWindow?.startHour ?? 9}
                className="w-16 px-2 py-1.5 rounded-lg bg-surface text-small text-text border border-[var(--c-engraving-fine)]"
              />
              <span className="text-small text-subtext">点到</span>
              <input
                name="end"
                type="number"
                min={0}
                max={23}
                defaultValue={plan.pushWindow?.endHour ?? 22}
                className="w-16 px-2 py-1.5 rounded-lg bg-surface text-small text-text border border-[var(--c-engraving-fine)]"
              />
              <span className="text-small text-subtext">点</span>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-sm text-small bg-accent text-base font-semibold"
              >
                保存
              </button>
              {plan.pushWindow ? (
                <button
                  type="button"
                  onClick={() => void clearPushWindow()}
                  className="px-3 py-1.5 rounded-sm text-small bg-danger/10 text-danger"
                >
                  清除
                </button>
              ) : null}
            </form>
          ) : null}

          {/* BYOK key 绑定 */}
          {plan?.plan === "byok" ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const key = new FormData(form).get("apiKey");
                if (typeof key === "string") void bindByokKey(key);
                form.reset();
              }}
            >
              <input
                name="apiKey"
                type="password"
                required
                placeholder={
                  plan.byok.keyBound ? "已绑定（输入新 key 可更换）" : "sk-…（DeepSeek API key）"
                }
                className="flex-1 px-3 py-2 rounded-sm bg-surface text-small text-text border border-[var(--c-engraving-fine)]"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-sm text-small bg-accent text-base font-semibold"
              >
                {plan.byok.keyBound ? "更换" : "绑定"}
              </button>
            </form>
          ) : null}
          {planError ? <p className="text-small text-danger mt-2">{planError}</p> : null}
        </div>

        {/* 宠物 IP 定制（#94）：Pro/BYOK 专属入口；免费用户无入口（平台预置 IP 系列） */}
        {plan && plan.plan !== "free" ? (
          <div className="p-6 paper-card rounded-sm">
            <h2 className="font-heading text-heading font-semibold text-text mb-2">
              宠物 IP 定制
            </h2>
            <p className="text-small text-subtext mb-4">
              描述你的专属街溜子 → 确认概念图 → 全自动生成 9 种状态的完整素材
              （四宫格主路径 + 两层质检；每月限 2 套）。确认后的概念图是角色锚点，
              后续表情包等生成都复用它。
            </p>
            <a
              href="/pet/customize"
              className="inline-block px-4 py-2 rounded-sm text-small bg-accent text-base font-semibold"
            >
              去定制
            </a>
          </div>
        ) : null}

        {/* 作息（#91）：宠物睡眠时间段——睡眠期停止游荡，前端展示睡觉 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-2">作息</h2>
          <p className="text-small text-subtext mb-4">
            设置宠物的睡眠时间段（本地时区，跨午夜合法）。睡眠期宠物停止游荡，前端展示睡觉状态。
          </p>
          {!sleepPet ? (
            <p className="text-small text-subtext">尚未领养宠物</p>
          ) : (
            <form
              className="flex gap-2 items-center"
              onSubmit={(e) => {
                e.preventDefault();
                const s = Number(new FormData(e.currentTarget).get("start"));
                const en = Number(new FormData(e.currentTarget).get("end"));
                if (Number.isInteger(s) && Number.isInteger(en)) {
                  void setSleepSchedule(s, en).then(() => {
                    setSleepSaved(true);
                    window.setTimeout(() => setSleepSaved(false), 2000);
                  });
                }
              }}
            >
              <span className="text-small text-subtext">睡眠</span>
              <input
                name="start"
                type="number"
                min={0}
                max={23}
                defaultValue={sleepPet.sleepStart ?? 22}
                className="w-16 px-2 py-1.5 rounded-lg bg-surface text-small text-text border border-[var(--c-engraving-fine)]"
              />
              <span className="text-small text-subtext">点到</span>
              <input
                name="end"
                type="number"
                min={0}
                max={23}
                defaultValue={sleepPet.sleepEnd ?? 7}
                className="w-16 px-2 py-1.5 rounded-lg bg-surface text-small text-text border border-[var(--c-engraving-fine)]"
              />
              <span className="text-small text-subtext">点</span>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-sm text-small bg-accent text-base font-semibold"
              >
                保存
              </button>
              {hasSleepSchedule ? (
                <button
                  type="button"
                  onClick={() => void clearSleepSchedule()}
                  className="px-3 py-1.5 rounded-sm text-small bg-danger/10 text-danger"
                >
                  清除
                </button>
              ) : null}
            </form>
          )}
          {petsError ? <p className="text-small text-danger mt-2">{petsError}</p> : null}
          {sleepSaved ? (
            <p className="text-small text-[var(--c-amber)] mt-2">已保存 — 睡眠期宠物停止游荡并展示睡觉状态</p>
          ) : null}
        </div>

        {/* 日记（#92）：风格选择 + 每日推送开关 */}
        <div className="p-6 paper-card rounded-sm">
          <h2 className="font-heading text-heading font-semibold text-text mb-2">日记</h2>
          <p className="text-small text-subtext mb-4">
            宠物每天睡前生成一篇性格化日记。风格可自定义（默认跟随宠物性格），可开启每日推送。
          </p>
          {!sleepPet ? (
            <p className="text-small text-subtext">尚未领养宠物</p>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2 items-center">
                <span className="text-small text-subtext">风格</span>
                {(
                  [
                    { value: "personality", label: "随性格" },
                    { value: "casual", label: "随意" },
                    { value: "careful", label: "认真" },
                    { value: "literary", label: "文艺" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={sleepPet.diaryStyle === opt.value}
                    onClick={() => void setDiaryStyle(opt.value)}
                    className={`px-3 py-1.5 rounded-sm text-small font-semibold ${
                      sleepPet.diaryStyle === opt.value
                        ? "bg-accent text-base"
                        : "bg-surface text-subtext border border-[var(--c-engraving-fine)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-small text-subtext">每日推送</span>
                <button
                  type="button"
                  onClick={() => void setDiaryPush(!sleepPet.diaryPushEnabled)}
                  className={`px-4 py-2 rounded-sm text-small font-semibold ${
                    sleepPet.diaryPushEnabled
                      ? "bg-accent text-base"
                      : "bg-surface text-subtext border border-[var(--c-engraving-fine)]"
                  }`}
                >
                  {sleepPet.diaryPushEnabled ? "已开启（点击关闭）" : "开启"}
                </button>
                <span className="text-xs text-subtext">
                  {sleepPet.diaryPushEnabled ? "日记生成后推送给你" : "仅生成，不推送"}
                </span>
              </div>
            </div>
          )}
          {petsError ? <p className="text-small text-danger mt-2">{petsError}</p> : null}
        </div>

        {/* 口头禅编辑（#114 切片 6） */}
        <CatchphraseEditor pet={sleepPet} onSave={(list) => setCatchphrases(list)} />
      </motion.div>
    </div>
  );
}
