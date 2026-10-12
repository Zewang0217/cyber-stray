import type { Metadata } from "next";
import { ApplyForm } from "./apply-form";

/**
 * 申请邀请函（公开页）：不收集邮箱/手机号等隐私——提交后当场发
 * 「申请号 + 查询码」凭据对，批准后凭它取回邀请链接。
 * 入口：官网 CTA、/need-invite。
 */
export const metadata: Metadata = {
  title: "申请邀请函 · STRAY-BOY",
};

export default function ApplyPage() {
  return (
    // 不用 min-h-screen：内容超一屏时会溢出容器，让 layout main 的
    // pb-16/pb-24 垫进溢出区中段，fixed 底部导航就盖住最后一段内容
    <div className="sb flex w-full flex-col items-center p-6">
      <ApplyForm />
    </div>
  );
}
