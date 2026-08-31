"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { pageHeader } from "./motion";

/**
 * 页面头部(全站统一):Latin kicker + 衬线标题 + 可选副标题 + 铜版分隔线入场。
 * 替代各页手搓的 motion.div 头部,统一层级(hero=主面/text-title=二级页)与 spring。
 */
interface PageHeaderProps {
  /** Latin 采集标注(kicker) */
  kicker?: string;
  title: string;
  subtitle?: React.ReactNode;
  /** 标题前导图标(表情包/梦境等画廊页) */
  icon?: React.ReactNode;
  /** 标题层级:hero=首页/历史推送,title=二级页 */
  size?: "hero" | "title";
  /** 标题行右侧插槽(如主题切换) */
  right?: React.ReactNode;
  /** 是否画铜版分隔线(默认画) */
  rule?: boolean;
  className?: string;
}

export function PageHeader({
  kicker,
  title,
  subtitle,
  icon,
  size = "title",
  right,
  rule = true,
  className,
}: PageHeaderProps): React.ReactElement {
  return (
    <motion.header
      className={cn("mb-8", className)}
      initial="hidden"
      animate="visible"
      variants={pageHeader}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {kicker ? (
            <p className="field-note text-sm text-subtext mb-1">{kicker}</p>
          ) : null}
          <div className="flex items-center gap-2">
            {icon ? <span className="shrink-0 text-[var(--c-amber)]">{icon}</span> : null}
            <h1
              className={cn(
                "font-heading font-semibold text-text truncate",
                size === "hero" ? "text-hero" : "text-title",
              )}
              style={{ letterSpacing: "-0.01em" }}
            >
              {title}
            </h1>
          </div>
          {subtitle ? <p className="text-body text-subtext mt-1">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {rule ? <div className="engraving-rule engraving-rule--draw mt-4" /> : null}
    </motion.header>
  );
}
