import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind CSS 类名
 * 先通过 clsx 处理条件类名，再通过 tailwind-merge 去重
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
