"use client";

import { useState } from "react";
import { useWebPush } from "@/hooks/useWebPush";
import { Switch } from "@/components/ui/Switch";
import { useChannels } from "@/hooks/useChannels";
import { usePlan } from "@/hooks/usePlan";
import { useWechatStatus } from "@/hooks/useWechatStatus";
import { usePets } from "@/hooks/usePets";
import { CatchphraseEditor } from "@/components/dashboard/CatchphraseEditor";
import type { Catchphrase } from "@cyber-stray/shared";

type View = "root" | "channels" | "pet" | "account" | "admin";

const ROWS: Array<[View, string, string]> = [
  ["channels", "通道", "飞书 / 微信 / 系统推送"],
  ["pet", "宠物", "作息 / 日记 / 口头禅"],
  ["account", "账号", "套餐 / BYOK / 退出"],
];

const DIARY_STYLES = [
  { value: "personality", label: "随性格" },
  { value: "casual", label: "随意" },
  { value: "careful", label: "认真" },
  { value: "literary", label: "文艺" },
] as const;

/** 设置（/settings，#170 T2）：游戏系统菜单——单列菜单行 → 子屏；功能全保留（旧页功能移植 + 新皮肤）。 */
export default function SettingsPage() {
  const [view, setView] = useState<View>("root");
  const { state: pushState, error: pushError, enable, disable } = useWebPush();
  const { channels, bindFeishu, unbindFeishu, error: channelError } = useChannels();
  const { plan, error: planError, switchPlan, setPushWindow, clearPushWindow, bindByokKey } = usePlan();
  const { status: wechatStatus } = useWechatStatus();
  const [sleepSaved, setSleepSaved] = useState(false);
  const { pets, setSleepSchedule, clearSleepSchedule, setDiaryStyle, setDiaryPush, setCatchphrases, error: petsError } = usePets();
  const sleepPet = pets[0] ?? null;
  const hasSleepSchedule = sleepPet !== null && sleepPet.sleepStart !== null && sleepPet.sleepEnd !== null;

  return (
    <div className="sb mx-auto max-w-2xl p-4">
      <h1 className="font-ps2p mb-4 text-xs text-[var(--hi)]">OPTION · 设置</h1>

      {view === "root" && (
        <div className="flex flex-col gap-2">
          {ROWS.map(([id, label, desc]) => (
            <button key={id} type="button" onClick={() => setView(id)}
              className="flex items-center justify-between border-2 border-[var(--curb)] bg-[var(--panel)] px-4 py-3 text-left shadow-[3px_3px_0_#000] hover:border-[var(--act)]">
              <span className="text-[15px] text-[var(--paper)]">{label}</span>
              <span className="text-[12px] text-[var(--curb)]">{desc} ▶</span>
            </button>
          ))}
        </div>
      )}

      {view === "channels" && (
        <SubView title="通道" onBack={() => setView("root")}>
          {/* 系统推送（S10 useWebPush）：关掉 App 也能收 */}
          <section className="mb-4 border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
            <h3 className="mb-1 text-[14px] text-[var(--paper)]">系统推送</h3>
            <p className="mb-2 text-[12px] leading-[1.6] text-[var(--curb)]">关掉 App 也能收到它的推送（浏览器系统级通知）</p>
            {pushState === "unsupported" ? (
              <p className="text-[13px] text-[var(--curb)]">当前浏览器不支持系统推送</p>
            ) : pushState === "denied" ? (
              <p className="text-[13px] text-[var(--bad)]">通知权限被拒绝——请在浏览器站点设置中允许通知后重试</p>
            ) : (
              <div className="flex items-center gap-3">
                <Switch checked={pushState === "on"} onCheckedChange={(on) => void (on ? enable() : disable())}
                  disabled={pushState === "subscribing"} aria-label="系统推送开关" />
                <span className="text-[13px] text-[var(--curb)]">
                  {pushState === "subscribing" ? "订阅中…" : pushState === "on" ? "已开启——关掉 App 也能收到" : "已关闭"}
                </span>
                {pushError ? <span className="text-[13px] text-[var(--bad)]">{pushError}</span> : null}
              </div>
            )}
          </section>

          <section className="mb-4 border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
            <h3 className="mb-1 text-[14px] text-[var(--paper)]">飞书（可选）</h3>
            <p className="mb-2 text-[12px] leading-[1.6] text-[var(--curb)]">绑定后推送同步发到飞书群机器人</p>
            {channels?.feishu ? (
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-[var(--ok)]">已绑定</span>
                <button type="button" onClick={() => void unbindFeishu()}
                  className="border-2 border-[var(--bad)] bg-[var(--sky)] px-2 py-1 text-[12px] text-[var(--bad)]">解绑</button>
              </div>
            ) : (
              <form className="flex gap-2" onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const webhook = new FormData(form).get("webhook");
                if (typeof webhook === "string") void bindFeishu(webhook);
                form.reset();
              }}>
                <input name="webhook" type="url" required placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
                  className="flex-1 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]" />
                <button type="submit" className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 text-[13px] text-[var(--paper)]">绑定</button>
              </form>
            )}
            {channelError ? <p className="mt-2 text-[13px] text-[var(--bad)]">{channelError}</p> : null}
          </section>

          <section className="border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
            <h3 className="mb-1 text-[14px] text-[var(--paper)]">微信（可选）</h3>
            <p className="mb-2 text-[12px] leading-[1.6] text-[var(--curb)]">扫码绑定后可在微信里和宠物聊天</p>
            {!wechatStatus ? (
              <p className="text-[13px] text-[var(--curb)]">加载中…</p>
            ) : !wechatStatus.bound ? (
              <a href="/wechat" className="text-[13px] text-[var(--act)] underline">去扫码绑定 ▶</a>
            ) : wechatStatus.status === "expired" ? (
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-[var(--bad)]">{wechatStatus.expiredHint ?? "微信通道已过期，发条消息重新激活"}</span>
                <a className="text-[13px] text-[var(--act)] underline" href={`/wechat?rebind=${encodeURIComponent(wechatStatus.tenantId ?? "")}`}>重新激活</a>
              </div>
            ) : (
              <span className="text-[13px] text-[var(--ok)]">已绑定（{wechatStatus.status === "active" ? "活跃中" : "等待激活"}）</span>
            )}
          </section>
        </SubView>
      )}

      {view === "pet" && (
        <SubView title="宠物" onBack={() => setView("root")}>
          {!sleepPet ? (
            <p className="text-[13px] text-[var(--curb)]">尚未领养宠物</p>
          ) : (
            <>
              <section className="mb-4 border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
                <h3 className="mb-1 text-[14px] text-[var(--paper)]">作息</h3>
                <p className="mb-2 text-[12px] leading-[1.6] text-[var(--curb)]">睡眠期宠物停止游荡，前端展示睡觉状态</p>
                <form className="flex items-center gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  const s2 = Number(new FormData(e.currentTarget).get("start"));
                  const en = Number(new FormData(e.currentTarget).get("end"));
                  if (Number.isInteger(s2) && Number.isInteger(en)) {
                    void setSleepSchedule(s2, en).then(() => {
                      setSleepSaved(true);
                      window.setTimeout(() => setSleepSaved(false), 2000);
                    });
                  }
                }}>
                  <span className="text-[13px] text-[var(--curb)]">睡眠</span>
                  <input name="start" type="number" min={0} max={23} defaultValue={sleepPet.sleepStart ?? 22}
                    className="w-16 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1 text-[13px] text-[var(--paper)]" />
                  <span className="text-[13px] text-[var(--curb)]">点到</span>
                  <input name="end" type="number" min={0} max={23} defaultValue={sleepPet.sleepEnd ?? 7}
                    className="w-16 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1 text-[13px] text-[var(--paper)]" />
                  <span className="text-[13px] text-[var(--curb)]">点</span>
                  <button type="submit" className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-1 text-[13px] text-[var(--paper)]">保存</button>
                  {hasSleepSchedule ? (
                    <button type="button" onClick={() => void clearSleepSchedule()}
                      className="border-2 border-[var(--bad)] bg-[var(--panel)] px-3 py-1 text-[13px] text-[var(--bad)]">清除</button>
                  ) : null}
                </form>
                {sleepSaved ? <p className="mt-2 text-[13px] text-[var(--ok)]">已保存——睡眠期宠物停止游荡并展示睡觉状态</p> : null}
              </section>

              <section className="mb-4 border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
                <h3 className="mb-1 text-[14px] text-[var(--paper)]">日记</h3>
                <p className="mb-2 text-[12px] leading-[1.6] text-[var(--curb)]">睡前生成性格化日记；风格可自定义，可开启每日推送</p>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-[var(--curb)]">风格</span>
                  {DIARY_STYLES.map((opt) => (
                    <button key={opt.value} type="button" disabled={sleepPet.diaryStyle === opt.value}
                      onClick={() => void setDiaryStyle(opt.value)}
                      className={`border-2 px-2 py-1 text-[12px] ${sleepPet.diaryStyle === opt.value ? "border-[var(--ok)] bg-[var(--panel)] text-[var(--ok)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-[var(--curb)]">每日推送</span>
                  <Switch checked={sleepPet.diaryPushEnabled} onCheckedChange={(on) => void setDiaryPush(on)}
                    aria-label="每日日记推送开关" />
                  <span className="text-[12px] text-[var(--curb)]">
                    {sleepPet.diaryPushEnabled ? "日记生成后推送给你" : "仅生成，不推送"}
                  </span>
                </div>
              </section>

              <CatchphraseEditor pet={sleepPet} onSave={(list) => setCatchphrases(list)} />
              {petsError ? <p className="mt-2 text-[13px] text-[var(--bad)]">{petsError}</p> : null}
            </>
          )}
        </SubView>
      )}

      {view === "account" && (
        <SubView title="账号" onBack={() => setView("root")}>
          <section className="mb-4 border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
            <h3 className="mb-1 text-[14px] text-[var(--paper)]">套餐</h3>
            <p className="mb-2 text-[12px] leading-[1.6] text-[var(--curb)]">
              {plan ? `当前 ${plan.plan.toUpperCase()} · 每日推送上限 ${plan.limits.pushesPerDay} 条` : "加载中…"}
              。宠物自进化永不设限，套餐只卡「到达主人」的频率。
            </p>
            <div className="mb-3 flex gap-2">
              {(["free", "pro", "byok"] as const).map((pc) => (
                <button key={pc} type="button" disabled={plan?.plan === pc} onClick={() => void switchPlan(pc)}
                  className={`border-2 px-3 py-1.5 text-[13px] ${plan?.plan === pc ? "border-[var(--ok)] bg-[var(--panel)] text-[var(--ok)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}>
                  {pc === "free" ? "免费" : pc === "pro" ? "Pro" : "BYOK"}
                </button>
              ))}
            </div>
            {plan && plan.plan !== "free" ? (
              <form className="flex items-center gap-2" onSubmit={(e) => {
                e.preventDefault();
                const s2 = Number(new FormData(e.currentTarget).get("start"));
                const en = Number(new FormData(e.currentTarget).get("end"));
                if (Number.isInteger(s2) && Number.isInteger(en)) void setPushWindow(s2, en);
              }}>
                <span className="text-[13px] text-[var(--curb)]">推送时间</span>
                <input name="start" type="number" min={0} max={23} defaultValue={plan.pushWindow?.startHour ?? 9}
                  className="w-16 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1 text-[13px] text-[var(--paper)]" />
                <span className="text-[13px] text-[var(--curb)]">点到</span>
                <input name="end" type="number" min={0} max={23} defaultValue={plan.pushWindow?.endHour ?? 22}
                  className="w-16 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1 text-[13px] text-[var(--paper)]" />
                <span className="text-[13px] text-[var(--curb)]">点</span>
                <button type="submit" className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-1 text-[13px] text-[var(--paper)]">保存</button>
                {plan.pushWindow ? (
                  <button type="button" onClick={() => void clearPushWindow()}
                    className="border-2 border-[var(--bad)] bg-[var(--panel)] px-3 py-1 text-[13px] text-[var(--bad)]">清除</button>
                ) : null}
              </form>
            ) : null}
            {plan?.plan === "byok" ? (
              <form className="mt-2 flex gap-2" onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const key = new FormData(form).get("apiKey");
                if (typeof key === "string") void bindByokKey(key);
                form.reset();
              }}>
                <input name="apiKey" type="password" required
                  placeholder={plan.byok.keyBound ? "已绑定（输入新 key 可更换）" : "sk-…（DeepSeek API key）"}
                  className="flex-1 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]" />
                <button type="submit" className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 text-[13px] text-[var(--paper)]">
                  {plan.byok.keyBound ? "更换" : "绑定"}
                </button>
              </form>
            ) : null}
            {planError ? <p className="mt-2 text-[13px] text-[var(--bad)]">{planError}</p> : null}
          </section>

          <section className="border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
            <h3 className="mb-1 text-[14px] text-[var(--paper)]">退出登录</h3>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="border-2 border-[var(--bad)] bg-[var(--panel)] px-3 py-1.5 text-[13px] text-[var(--bad)]">
                退出（POST /api/auth/logout）
              </button>
            </form>
          </section>
        </SubView>
      )}

      {view === "admin" && (
        <SubView title="维修口" onBack={() => setView("root")}>
          <p className="text-[13px] leading-[1.8] text-[var(--paper)]">
            管理员功能在 <a href="/admin" className="text-[var(--act)] underline">/admin</a>（维修口形态，随维修口票重铸）。
          </p>
        </SubView>
      )}
    </div>
  );
}

function SubView({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-[13px] text-[var(--curb)]">◀ 返回</button>
      <h2 className="font-ps2p mb-3 text-xs text-[var(--hi)]">{title}</h2>
      {children}
    </div>
  );
}
