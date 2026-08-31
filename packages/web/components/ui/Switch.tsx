"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * 开关(图鉴世界:纸面拨杆——关=纸色+铜版细框,开=琥珀示能+墨杆)
 * Radix Switch 原语:键盘可达、ARIA switch、受控/非受控。
 */
interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** 视觉标签(读屏用) */
  "aria-label"?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: SwitchProps): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "inline-flex w-10 h-6 shrink-0 items-center rounded-full border px-0.5",
        "bg-[var(--c-paper)] border-[var(--c-engraving-fine)]",
        "data-[state=checked]:border-[var(--c-amber)] data-[state=checked]:bg-[color-mix(in_oklch,var(--c-amber)_18%,var(--c-paper))]",
        "transition-colors duration-200 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-amber)]",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block w-4 h-4 rounded-full bg-[var(--c-ink)]",
          "translate-x-0 data-[state=checked]:translate-x-[18px]",
          "transition-transform duration-200 ease-out",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
