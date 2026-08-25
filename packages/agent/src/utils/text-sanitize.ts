/**
 * 进 LLM prompt 的文本清洗（#125）
 *
 * 孤立代理（lone surrogate）来自外部数据——LLM 输出被截断（emoji 代理对被
 * 切断）、网页抓取坏字符等。JSON.stringify 会把孤立代理输出为 `\udXXX`
 * （JS 的 JSON.parse 接受，合法 JSON），但 DeepSeek 等服务端解析器拒绝
 * （400 "unexpected end of hex escape"）→ 游荡/日记/反思首步必失败，且
 * consecutiveFailures 持续递增、无日志可见（worker 日志曾全丢）。
 *
 * 所有进 generateText 的 system/user prompt 统一过这里，移除孤立代理。
 */

/** 移除孤立代理：高代理后无低代理、或低代理前无高代理 */
export function sanitizeForLLM(text: string): string {
  if (!text) return text;
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  );
}
