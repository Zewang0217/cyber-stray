"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /footprint → 街角 LOG 存档抽屉（#170：游戏 log 不留历史，历史在抽屉）。
 * 旧路由重定向保留可分享性；抽屉内容在街角页内。
 */
export default function FootprintPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/?drawer=log");
  }, [router]);
  return null;
}
