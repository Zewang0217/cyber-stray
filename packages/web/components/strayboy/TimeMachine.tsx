"use client";

import { useState } from "react";
import type { EvolutionSnapshot } from "@/hooks/useEvolution";

/**
 * 时间机器（#170）：像素墨条时间轴 + SAVE SLOT 纸面便签（mono 日期 + VT323 熵 +
 * 来源 hash 短签）+ 回滚 = 「读取存档 LOAD」语法 + DialogBox 确认。
 * 回滚成功后由父级演出猫 grumpy。
 */
export function TimeMachine({
  snapshots,
  onLoad,
  rolling,
}: {
  snapshots: EvolutionSnapshot[];
  onLoad: (hash: string) => Promise<boolean>;
  rolling: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async (hash: string): Promise<void> => {
    setConfirming(null);
    const ok = await onLoad(hash);
    setMessage(ok ? "唔……回到这一天了。（猫看起来不太高兴）" : "读取存档失败（网络/权限），什么都没变。");
  };

  if (snapshots.length === 0) {
    return <p className="py-12 text-center text-[14px] text-[var(--curb)]">还没有存档。兴趣第一次进化后，这里会出现 SAVE 槽。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-[1.7] text-[var(--curb)]">
        像素墨条时间轴：每格 = 一次兴趣快照。读取存档 LOAD 会把兴趣图谱回滚到那一刻。
      </p>
      {/* 像素墨条时间轴：一格一快照，最新在最右 */}
      <div aria-hidden className="flex h-4 items-end gap-[3px] border-2 border-black bg-[var(--panel)] p-1">
        {snapshots.map((s, i) => (
          <b
            key={s.hash}
            title={`#${i + 1} 熵 ${s.entropy.toFixed(2)}`}
            className="flex-1 bg-[var(--hi)]"
            style={{ height: `${30 + ((i * 37) % 70)}%` }}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {snapshots.map((s) => (
          <div key={s.hash} className="relative border-2 border-[var(--ink)] bg-[var(--paper)] p-3 pt-5 shadow-[4px_4px_0_#000] -rotate-1">
            {/* 纸面图钉 */}
            <span aria-hidden className="absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 bg-[var(--bad)]" />
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] tracking-wider text-[var(--ink)]">
                SAVE · {new Date(s.timestamp).toISOString().slice(0, 10)}
              </span>
              <span className="font-vt323 text-[20px] text-[var(--curb)]">熵 {s.entropy.toFixed(2)}</span>
            </div>
            <p className="mt-1 font-vt323 text-[16px] text-[var(--curb)]">
              {s.nodes.length} 个话题 · hash {s.hash.slice(0, 8)}
            </p>
            <button
              type="button"
              disabled={rolling}
              onClick={() => setConfirming(s.hash)}
              className="mt-2 w-full border-2 border-[var(--ink)] bg-[var(--hi)] px-2 py-1 font-ps2p text-xs text-[var(--ink)]"
            >
              ▶ LOAD
            </button>
            {confirming === s.hash && (
              <div className="mt-2 border-2 border-[var(--ink)] bg-[var(--sky)] p-2">
                <p className="mb-2 text-[12px] leading-[1.6] text-[var(--paper)]">
                  读取这一天的存档？当前图谱将被覆盖，猫要重新认识你。
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void load(s.hash)}
                    className="flex-1 border-2 border-[var(--ok)] bg-[var(--panel)] px-2 py-1 font-ps2p text-xs text-[var(--ok)]"
                  >
                    LOAD
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="flex-1 border-2 border-[var(--curb)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--paper)]"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {message && (
        <p className="border-2 border-[var(--ink)] bg-[var(--paper)] p-2.5 text-[13px] text-[var(--ink)] shadow-[4px_4px_0_#000]">
          {message}
        </p>
      )}
    </div>
  );
}
