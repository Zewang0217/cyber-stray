import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSpeakSourceUrl } from "@cyber-stray/shared/push";

/** 只显示可读文本与 HTTP(S) 链接；历史正文不能注入 HTML 或自动加载外部图片。 */
export function PostcardMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      allowedElements={["p", "strong", "em", "del", "a", "ul", "ol", "li", "blockquote", "code", "pre", "br", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td"]}
      unwrapDisallowed
      urlTransform={(url) => getSpeakSourceUrl(url) ?? ""}
      components={{
        a: ({ href, children }) => href
          ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--act)] underline underline-offset-4">{children}</a>
          : <span>{children}</span>,
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="mb-3 border-l-4 border-[var(--curb)] pl-3">{children}</blockquote>,
        code: ({ children }) => <code className="break-all bg-[var(--panel)] px-1 text-[var(--paper)]">{children}</code>,
        table: ({ children }) => <div className="mb-3 overflow-x-auto"><table className="w-full border-collapse text-left">{children}</table></div>,
        th: ({ children }) => <th className="border-2 border-[var(--curb)] p-1">{children}</th>,
        td: ({ children }) => <td className="border-2 border-[var(--curb)] p-1">{children}</td>,
      }}
    >{text}</ReactMarkdown>
  );
}
