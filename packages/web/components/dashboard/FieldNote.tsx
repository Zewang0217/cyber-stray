"use client";

import { motion } from "framer-motion";

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
}

export function FieldNote({
  label,
  value,
  suffix,
  mono = false,
  large = false,
  isReading = false,
}: FieldNoteProps): React.ReactElement {
  return (
    <motion.div
      className="paper-card p-3"
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 },
      }}
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
        {value}
        {suffix && (
          <span className="field-note text-xs text-subtext ml-1">
            {suffix}
          </span>
        )}
      </p>
    </motion.div>
  );
}
