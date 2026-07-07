"use client";

import { motion } from "framer-motion";

interface RadarScanProps {
  size?: number;
}

export function RadarScan({ size = 100 }: RadarScanProps): React.ReactElement {
  return (
    <motion.div
      className="relative"
      style={{ width: size, height: size }}
    >
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0%, oklch(0.702 0.148 326.5 / 0.3) 30%, transparent 60%)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="w-4 h-4 rounded-full bg-accent"
          animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </div>
    </motion.div>
  );
}