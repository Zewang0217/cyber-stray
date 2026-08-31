"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/**
 * 统一按钮(活版印刷规格,见 globals.css .btn-* 与 DESIGN.md)
 * variant:primary=墨底纸字+hover 琥珀底阴影;secondary=纸底铜版细框;
 * danger=警告色;ghost=纯文字。
 * 尺寸:sm=表内/紧凑,md=常规,lg=主行动。
 * asChild:渲染为 Link 等自定义元素(传 href 时用)。
 */
type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  ghost: "bg-transparent text-subtext hover:text-text transition-colors",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-small",
  md: "px-4 py-2 text-small",
  lg: "px-5 py-2.5 text-small",
};

export function Button({
  variant = "primary",
  size = "md",
  asChild = false,
  className,
  type = "button",
  ...props
}: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-sm select-none disabled:opacity-50",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  );
}
