"use client";

import { motion } from "framer-motion";
import { useAdmin } from "@/hooks/useAdmin";

/**
 * 运营管理面板（S13）：全部租户宠物总览 + 额度分配 + 暂停/恢复。
 * 非管理员（403）显示无权限提示。
 */
export default function AdminPage(): React.ReactElement {
  const { rows, error, isAdmin, setPlan, setStatus } = useAdmin();

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

  if (!rows) {
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
          全部租户宠物总览 · 共 {rows.length} 只
        </p>
      </motion.div>

      <motion.div
        className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-subtext border-b border-white/10">
              <th className="py-2 pr-3">租户</th>
              <th className="py-2 pr-3">宠物</th>
              <th className="py-2 pr-3">套餐</th>
              <th className="py-2 pr-3">状态</th>
              <th className="py-2 pr-3">无聊/精力</th>
              <th className="py-2 pr-3">游荡</th>
              <th className="py-2 pr-3">推送</th>
              <th className="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenantId} className="border-b border-white/5">
                <td className="py-3 pr-3">
                  <div className="font-semibold">{r.tenantName}</div>
                  <div className="text-xs text-subtext font-mono">{r.tenantId.slice(0, 8)}</div>
                </td>
                <td className="py-3 pr-3">{r.petName}</td>
                <td className="py-3 pr-3">
                  <select
                    value={r.plan}
                    onChange={(e) =>
                      void setPlan(r.tenantId, e.target.value as typeof r.plan)
                    }
                    className="px-2 py-1 rounded-lg bg-surface text-small text-text border border-white/10"
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="byok">byok</option>
                  </select>
                </td>
                <td className="py-3 pr-3">
                  <span
                    className={
                      r.status === "active" ? "text-success" : "text-subtext"
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="py-3 pr-3">
                  {r.boredom} / {r.energy}
                </td>
                <td className="py-3 pr-3">{r.totalWanders}</td>
                <td className="py-3 pr-3">{r.totalPushes}</td>
                <td className="py-3">
                  <button
                    type="button"
                    onClick={() =>
                      void setStatus(
                        r.tenantId,
                        r.status === "active" ? "paused" : "active",
                      )
                    }
                    className={`px-3 py-1 rounded-xl text-xs font-semibold ${
                      r.status === "active"
                        ? "bg-danger/10 text-danger"
                        : "bg-accent/10 text-accent"
                    }`}
                  >
                    {r.status === "active" ? "暂停" : "恢复"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
      </motion.div>
    </div>
  );
}
