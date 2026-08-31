"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 对话框(图鉴登记卡式:纸卡 + 铜版细框 + 衬线标题)
 * Radix Dialog 原语:焦点陷阱、Esc 关闭、ARIA dialog。
 * 入场/退场动画走 data-state + globals.css 的 overlay/content keyframes。
 */

const DialogRoot = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[70] bg-[color-mix(in_oklch,var(--c-ink)_35%,transparent)]",
      "data-[state=open]:animate-[dialog-overlay-in_0.2s_ease-out]",
      "data-[state=closed]:animate-[dialog-overlay-out_0.15s_ease-in]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-0 z-[71] m-auto h-fit max-h-[calc(100vh-2rem)] overflow-y-auto",
        "w-[calc(100vw-2rem)] max-w-md p-6 paper-card rounded-sm",
        "data-[state=open]:animate-[dialog-content-in_0.22s_cubic-bezier(0.16,1,0.3,1)]",
        "data-[state=closed]:animate-[dialog-content-out_0.15s_ease-in]",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 p-1 text-subtext hover:text-text transition-colors" aria-label="关闭">
        <X className="w-4 h-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

/** 组合式便捷导出:标题行(采集标注 + 衬线标题) */
function DialogHeading({
  kicker,
  title,
}: {
  kicker?: string;
  title: string;
}): React.ReactElement {
  return (
    <div className="mb-4 pr-8">
      {kicker ? <p className="field-note text-sm text-subtext mb-1">{kicker}</p> : null}
      <DialogTitle className="font-heading text-heading font-semibold text-text">
        {title}
      </DialogTitle>
    </div>
  );
}

export {
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeading,
  DialogTitle,
  DialogDescription,
};
