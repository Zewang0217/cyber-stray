"use client";

import { motion } from "framer-motion";
import { RevisingValue } from "@/components/ui/RevisingValue";
import { staggerItem } from "@/components/ui/motion";

/**
 * FieldNote - 采集者笔记读数
 * 替代废弃的 StatCard(icon+heading+text 同尺寸卡片,踩 craft-floor rut)。
 *
 * 做成图鉴页边的测量标注:手写标签 + 等宽数字 + 手写注解。
 */
interface FieldNoteProps {
  label: string;
  value: string | number;
  suffix?: string;
  /** 等宽读数(数字) */
  mono?: boolean;
  /** 大读数(统计用) */
  large?: boolean;
  /** 读数样式(带/100 后缀,状态色) */
  isReading?: boolean;
  /** 追加类名(如响应式栅格跨越) */
  className?: string;
}

export function FieldNote({
  label,
  value,
  suffix,
  mono = false,
  large = false,
  isReading = false,
  className,
}: FieldNoteProps): React.ReactElement {
  return (
    <motion.div
      className={`paper-card p-3 ${className ?? ""}`}
      variants={staggerItem}
    >
      <p className="field-note text-xs text-subtext uppercase tracking-wider mb-1">
        {label}
      </p>
      <p
        className={
          large
            ? "mono-reading text-title text-text"
            : isReading
              ? "mono-reading text-heading text-text"
              : mono
                ? "mono-reading text-sm text-text"
                : "font-heading text-sm text-text"
        }
      >
        {/* 值变化 → 修订闪光重放(采集者擦改笔记);首屏不闪 */}
        <RevisingValue value={value} />
        {suffix && (
          <span className="field-note text-xs text-subtext ml-1">
            {suffix}
          </span>
        )}
      </p>
    </motion.div>
  );
}
