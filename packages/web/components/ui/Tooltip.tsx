"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/**
 * 提示气泡(采集者手写旁注:纸色 + 铜版细框 + Caveat 手写体)
 * Radix Tooltip 原语:键盘可达、指针/焦点双触发、延迟 200ms。
 */
interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps): React.ReactElement {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className={cn(
              "z-tooltip max-w-[220px] px-2.5 py-1 rounded-sm",
              "bg-[var(--c-paper)] border border-[var(--c-engraving-fine)]",
              "shadow-[0_2px_8px_0_color-mix(in_oklch,var(--c-ink)_15%,transparent)]",
              "field-note text-sm text-text",
              "data-[state=delayed-open]:animate-[dialog-content-in_0.15s_cubic-bezier(0.16,1,0.3,1)]",
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[var(--c-engraving-fine)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
