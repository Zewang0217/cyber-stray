"use client";

import { useState } from "react";
import { useAdmin } from "@/hooks/useAdmin";
import UsagePanel from "./usage-panel";

/**
 * 维修口（/admin，#170 T2 最后铸）：保功能可用 + 世界底线（直角/14 色/实色影/
 * 像素按钮），无游戏 chrome；桌面宽表格。雾区条目就地不显示。
 * 非管理员（403）显示无权限提示。
 */
export default function AdminPage(): React.ReactElement {
  const { users, admins, error, isAdmin, setPlan, setPetStatus, grantAdmin, revokeAdmin } =
    useAdmin();
  const [grantSub, setGrantSub] = useState("");
  const [tab, setTab] = useState<"users" | "usage">("users");

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

  return (
    <div className="sb mx-auto max-w-6xl p-4">
      <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">MAINTENANCE · 维修口</h1>
      <p className="mb-4 text-[13px] text-[var(--curb)]">
        全部用户 · 共 {users.length} 人 · {users.filter((u) => u.petId).length} 只有宠物
      </p>

      {/* 子面板切换：像素按钮（非游戏 tab chrome） */}
      <div className="mb-4 flex gap-2">
        {([["users", "用户管理"], ["usage", "用量"]] as const).map(([id, label]) => (
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

      {tab === "users" && (
        <>
          {/* 用户表：桌面宽表格（维修口无游戏 chrome） */}
          <div className="overflow-x-auto border-2 border-black bg-[var(--panel)] shadow-[5px_5px_0_#000]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b-2 border-black text-left text-[var(--hi)]">
                  <th className="px-3 py-2.5">用户</th>
                  <th className="px-3 py-2.5">套餐</th>
                  <th className="px-3 py-2.5">宠物</th>
                  <th className="px-3 py-2.5">状态</th>
                  <th className="px-3 py-2.5">游荡/推送</th>
                  <th className="px-3 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.tenantId} className="border-t border-[var(--street)]">
                    <td className="px-3 py-2.5">
                      <div className="text-[var(--paper)]">{u.tenantName}</div>
                      <div className="font-vt323 text-[14px] text-[var(--curb)]">{u.tenantId.slice(0, 8)}</div>
                      {!u.petId ? <div className="text-[12px] text-[var(--curb)]">（无宠物）</div> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={u.plan}
                        onChange={(e) => void setPlan(u.tenantId, e.target.value as typeof u.plan)}
                        className="border-2 border-[var(--curb)] bg-[var(--sky)] px-1.5 py-1 text-[13px] text-[var(--paper)]"
                      >
                        <option value="free">free</option>
                        <option value="pro">pro</option>
                        <option value="byok">byok</option>
                      </select>
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
                      <span className={u.petStatus === "active" ? "text-[var(--ok)]" : "text-[var(--curb)]"}>
                        {u.petStatus ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-vt323 text-[16px]">
                      {u.totalWanders} / {u.totalPushes}
                    </td>
                    <td className="px-3 py-2.5">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 管理员管理（RBAC）：env 授权不可撤销 */}
          <div className="mt-6 border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
            <h2 className="mb-1 text-[14px] text-[var(--paper)]">管理员</h2>
            <p className="mb-3 text-[12px] leading-[1.7] text-[var(--curb)]">
              身份在 Casdoor（谁可登录），权限在控制面（能做什么）——管理员可看全部用户、分配套餐、授权他人。
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
        </>
      )}
    </div>
  );
}
