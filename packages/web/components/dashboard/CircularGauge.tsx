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
            <filter id={`liquid-${label}`}>
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.02"
                numOctaves="3"
                result="noise"
                seed={label.length * 17 + value}
              >
                <animate
                  attributeName="baseFrequency"
                  values="0.02;0.04;0.02"
                  dur="3s"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="3"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>

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
            filter={`url(#glow-${label}) url(#liquid-${label})`}
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="font-mono text-body font-bold"
            style={{ color }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            {Math.round(value)}
          </motion.span>
        </div>
      </div>

      <span className="text-xs-fluid font-medium text-subtext uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}