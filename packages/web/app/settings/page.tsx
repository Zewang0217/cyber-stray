"use client";

import { useState } from "react";
import { useChannels } from "@/hooks/useChannels";
import { usePets } from "@/hooks/usePets";

type View = "root" | "channels" | "pet" | "account" | "admin";

const ROWS: Array<[View, string, string]> = [
  ["channels", "通道", "飞书推送绑定"],
  ["pet", "宠物", "作息与口头禅"],
  ["account", "账号", "登录信息"],
  ["admin", "维修口", "管理员功能"],
];

/**
 * 设置（/settings，#170 映射 T2）：游戏系统菜单——单列菜单行 → 子屏。
 * 通道（飞书绑定）/ 宠物（作息/口头禅清单）/ 账号 / 维修口入口。
 */
export default function SettingsPage() {
  const [view, setView] = useState<View>("root");
  const { channels, bindFeishu, unbindFeishu, error: channelError } = useChannels();
  const { pets } = usePets();
  const pet = pets[0];

  return (
    <div className="sb mx-auto max-w-2xl p-4">
      <h1 className="font-ps2p mb-4 text-xs text-[var(--hi)]">OPTION · 设置</h1>

      {view === "root" && (
        <div className="flex flex-col gap-2">
          {ROWS.map(([id, label, desc]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className="flex items-center justify-between border-2 border-[var(--curb)] bg-[var(--panel)] px-4 py-3 text-left shadow-[3px_3px_0_#000] hover:border-[var(--act)]"
            >
              <span className="text-[15px] text-[var(--paper)]">{label}</span>
              <span className="text-[12px] text-[var(--curb)]">{desc} ▶</span>
            </button>
          ))}
        </div>
      )}

      {view === "channels" && (
        <SubView title="通道" onBack={() => setView("root")}>
          {channelError && (
            <p className="mb-3 border-2 border-[var(--bad)] bg-[var(--sky)] p-2 text-[13px] text-[var(--bad)]">
              {channelError}
            </p>
          )}
          <ChannelRow
            name="飞书"
            bound={channels?.feishu === true}
            onBind={(webhook) => void bindFeishu(webhook)}
            onUnbind={() => void unbindFeishu()}
          />
          <p className="mt-3 text-[12px] leading-[1.7] text-[var(--curb)]">
            Web Push 默认开启（浏览器授权后生效），无需在此配置。
          </p>
        </SubView>
      )}

      {view === "pet" && (
        <SubView title="宠物" onBack={() => setView("root")}>
          {pet ? (
            <div className="flex flex-col gap-2 text-[14px] leading-[1.8] text-[var(--paper)]">
              <p>名字：{pet.name}</p>
              <p>作息：{pet.sleepStart !== null && pet.sleepEnd !== null ? `${pet.sleepStart}:00 – ${pet.sleepEnd}:00` : "未设置（全天活动）"}</p>
              <p>口头禅：{(pet.catchphrases ?? []).map((c) => c.text).join(" / ") || "（性格默认组）"}</p>
              <p className="text-[12px] text-[var(--curb)]">编辑入口随后续票接入。</p>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--curb)]">还没有宠物。</p>
          )}
        </SubView>
      )}

      {view === "account" && (
        <SubView title="账号" onBack={() => setView("root")}>
          <p className="text-[14px] leading-[1.9] text-[var(--paper)]">
            登录经 Casdoor 统一认证；会话由控制面管理。
            <br />
            退出登录：<a href="/api/auth/logout" className="text-[var(--act)] underline">/api/auth/logout</a>
          </p>
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

function ChannelRow({ name, bound, onBind, onUnbind }: {
  name: string;
  bound: boolean;
  onBind: (webhook: string) => void;
  onUnbind: () => void;
}) {
  const [webhook, setWebhook] = useState("");
  return (
    <div className="border-2 border-[var(--curb)] bg-[var(--panel)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[15px] text-[var(--paper)]">{name}</span>
        <span className={`text-[12px] ${bound ? "text-[var(--ok)]" : "text-[var(--curb)]"}`}>
          {bound ? "已绑定" : "未绑定"}
        </span>
      </div>
      {!bound && (
        <div className="mt-2 flex gap-2">
          <input
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="飞书群机器人 Webhook"
            className="flex-1 border-2 border-[var(--curb)] bg-[var(--sky)] px-2 py-1.5 text-[13px] text-[var(--paper)]"
          />
          <button
            type="button"
            disabled={webhook.trim().length === 0}
            onClick={() => onBind(webhook.trim())}
            className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 text-[13px] text-[var(--paper)]"
          >
            绑定
          </button>
        </div>
      )}
      {bound && (
        <button
          type="button"
          onClick={onUnbind}
          className="mt-2 border-2 border-[var(--bad)] bg-[var(--panel)] px-3 py-1 text-[12px] text-[var(--bad)]"
        >
          解绑
        </button>
      )}
    </div>
  );
}
