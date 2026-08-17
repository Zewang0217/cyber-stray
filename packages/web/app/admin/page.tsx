"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useAdmin } from "@/hooks/useAdmin";

/**
 * 运营管理面板（S14）：全部用户（含无宠物）+ 用户套餐分配 + 宠物摘要
 * 卡片 + 暂停/恢复 + 管理员管理（RBAC 授权）。
 * 非管理员（403）显示无权限提示。
 */
export default function AdminPage(): React.ReactElement {
  const { users, admins, error, isAdmin, setPlan, setPetStatus, grantAdmin, revokeAdmin } =
    useAdmin();
  const [grantSub, setGrantSub] = useState("");

  if (isAdmin === false) {
    return (
      <div className="spacing-lg max-w-6xl mx-auto">
        <h1 className="font-heading text-heading font-bold text-text mb-2">管理面板</h1>
        <div className="p-6 rounded-2xl bg-danger/10 border border-danger/20">
          <p className="text-sm text-danger">无权限：仅管理员（CP_ADMIN_SUBS 白名单）可访问。</p>
        </div>
      </div>
    );
  }

  if (!users) {
    return (
      <div className="spacing-lg max-w-6xl mx-auto">
        <h1 className="font-heading text-heading font-bold text-text mb-2">管理面板</h1>
        <p className="text-body text-subtext">加载中…</p>
        {error ? <p className="text-small text-danger mt-2">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="spacing-lg max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <h1 className="font-heading text-heading font-bold text-text mb-1">管理面板</h1>
        <p className="text-body text-subtext mb-6">
          全部用户 · 共 {users.length} 人 · {users.filter((u) => u.petId).length} 只有宠物
        </p>
      </motion.div>

      {/* 用户列表 */}
      <motion.div
        className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-subtext border-b border-white/10">
              <th className="py-2 pr-3">用户</th>
              <th className="py-2 pr-3">套餐</th>
              <th className="py-2 pr-3">宠物</th>
              <th className="py-2 pr-3">状态</th>
              <th className="py-2 pr-3">游荡/推送</th>
              <th className="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.tenantId} className="border-b border-white/5">
                <td className="py-3 pr-3">
                  <div className="font-semibold">{u.tenantName}</div>
                  <div className="text-xs text-subtext font-mono">{u.tenantId.slice(0, 8)}</div>
                  {!u.petId ? (
                    <div className="text-xs text-subtext mt-0.5">（无宠物）</div>
                  ) : null}
                </td>
                <td className="py-3 pr-3">
                  <select
                    value={u.plan}
                    onChange={(e) =>
                      void setPlan(u.tenantId, e.target.value as typeof u.plan)
                    }
                    className="px-2 py-1 rounded-lg bg-surface text-small text-text border border-white/10"
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="byok">byok</option>
                  </select>
                </td>
                <td className="py-3 pr-3">
                  {u.petId ? (
                    <div>
                      <div className="font-medium">{u.petName}</div>
                      <div className="text-xs text-subtext">
                        无聊 {u.petBoredom} / 精力 {u.petEnergy}
                      </div>
                    </div>
                  ) : (
                    <span className="text-subtext">—</span>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <span className={u.petStatus === "active" ? "text-success" : "text-subtext"}>
                    {u.petStatus ?? "—"}
                  </span>
                </td>
                <td className="py-3 pr-3">
                  {u.totalWanders} / {u.totalPushes}
                </td>
                <td className="py-3">
                  {u.petId ? (
                    <button
                      type="button"
                      onClick={() =>
                        void setPetStatus(u.tenantId, u.petStatus === "active" ? "paused" : "active")
                      }
                      className={`px-3 py-1 rounded-xl text-xs font-semibold ${
                        u.petStatus === "active"
                          ? "bg-danger/10 text-danger"
                          : "bg-accent/10 text-accent"
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
      </motion.div>

      {/* 管理员管理（RBAC） */}
      <motion.div
        className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="font-heading text-heading font-bold text-text mb-2">管理员</h2>
        <p className="text-small text-subtext mb-4">
          身份在 Casdoor（谁可登录），权限在控制面（能做什么）——管理员可看全部用户、分配套餐、授权他人。
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {admins?.map((a) => (
            <span
              key={a.sub}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-surface border border-white/10 text-xs"
            >
              <span className="font-mono">{a.sub.slice(0, 12)}</span>
              <span className="text-subtext">
                {a.grantedBy === "env" ? "(env)" : `由 ${a.grantedBy.slice(0, 8)} 授予`}
              </span>
              {a.grantedBy !== "env" ? (
                <button
                  type="button"
                  onClick={() => void revokeAdmin(a.sub)}
                  className="text-danger hover:underline"
                >
                  撤销
                </button>
              ) : null}
            </span>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (grantSub.trim()) void grantAdmin(grantSub.trim());
            setGrantSub("");
          }}
        >
          <input
            value={grantSub}
            onChange={(e) => setGrantSub(e.target.value)}
            placeholder="输入用户 sub（Casdoor）授予管理员"
            className="flex-1 px-3 py-2 rounded-xl bg-surface text-small text-text border border-white/10 font-mono"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-small bg-accent text-base font-semibold"
          >
            授权
          </button>
        </form>
        {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
      </motion.div>
    </div>
  );
}
