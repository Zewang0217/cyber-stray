"use client";

import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { RevisingValue } from "@/components/ui/RevisingValue";
import { staggerItem } from "@/components/ui/motion";

/**
 * FieldNote - 采集者笔记读数
 * 替代废弃的 StatCard(icon+heading+text 同尺寸卡片,踩 craft-floor rut)。
 *
 * 做成图鉴页边的测量标注:手写标签 + 等宽数字 + 手写注解。
 * variant:入场变体(默认 staggerItem;焦点序列用 noteItem 等)。
 * animated:大统计数字用「采集者清点」计数代替修订闪光。
 */
interface FieldNoteProps {
  label: string;
  value: string | number;
  suffix?: string;
  /** 等宽读数(数字) */
  mono?: boolean;
  /** 大读数(统计用) */
  large?: boolean;
  /** 入场变体(默认 staggerItem;焦点序列用 noteItem 等) */
  variant?: Variants;
  /** 大统计:数字用「采集者清点」计数代替修订闪光 */
  animated?: boolean;
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
  variant = staggerItem,
  animated = false,
  isReading = false,
  className,
}: FieldNoteProps): React.ReactElement {
  return (
    <motion.div
      className={`paper-card p-3 ${className ?? ""}`}
      variants={variant}
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
        {animated ? (
          /* 大统计:采集者重新清点(值变化才重放);省略修订闪光避免双重反馈 */
          <AnimatedNumber value={Number(value)} />
        ) : (
          /* 值变化 → 修订闪光重放(采集者擦改笔记);首屏不闪 */
          <RevisingValue value={value} />
        )}
        {suffix && (
          <span className="field-note text-xs text-subtext ml-1">
            {suffix}
          </span>
        )}
      </p>
    </motion.div>
  );
}
