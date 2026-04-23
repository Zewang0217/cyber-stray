"use client";

import { motion } from "framer-motion";

interface CircularGaugeProps {
  value: number;
  max?: number;
  color: string;
  label: string;
  size?: number;
  strokeWidth?: number;
}

/**
 * 环形发光进度条
 * 用于展示 boredom / energy / temper 等状态值
 */
export function CircularGauge({
  value,
  max = 100,
  color,
  label,
  size = 120,
  strokeWidth = 8,
}: CircularGaugeProps): React.ReactElement {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const percentage = Math.min(Math.max(value / max, 0), 1);
  const strokeDashoffset = circumference - percentage * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {/* 发光滤镜背景 */}
        <svg
          width={size}
          height={size}
          className="absolute inset-0 rotate-[-90deg]"
        >
          <defs>
            <filter id={`glow-${label}`}>
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* 背景轨道 */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-surface"
            opacity={0.3}
          />

          {/* 进度条 */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            filter={`url(#glow-${label})`}
          />
        </svg>

        {/* 中心数值 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="font-mono text-lg font-bold"
            style={{ color }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            {Math.round(value)}
          </motion.span>
        </div>
      </div>

      {/* 标签 */}
      <span className="text-xs font-medium text-subtext uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
