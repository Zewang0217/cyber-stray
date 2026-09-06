/**
 * 对话框（DESIGN.md §4-6）：paper 底 + 底部三角尾巴 + <名字> 标签，游戏 AV 语法。
 */
export function DialogBox({ name, text }: { name: string; text: string }) {
  return (
    <div className="relative max-w-[260px]">
      <span className="absolute -top-3 left-3 border-2 border-[var(--ink)] bg-[var(--paper)] px-1.5 py-0.5 font-ps2p text-xs leading-none text-[var(--ink)]">
        {name}
      </span>
      <div className="border-4 border-[var(--ink)] bg-[var(--paper)] px-3 py-2.5 text-[14px] leading-[1.6] text-[var(--ink)] shadow-[6px_6px_0_#000]">
        {text}
      </div>
      {/* 尾巴：两段实色三角（禁 blur） */}
      <div aria-hidden className="flex justify-center">
        <div className="h-0 w-0 border-x-[10px] border-t-[12px] border-x-transparent border-t-[var(--ink)]" />
      </div>
    </div>
  );
}
