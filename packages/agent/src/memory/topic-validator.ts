/**
 * 话题准入校验（#176）：兴趣图谱的节点 id 必须像「话题」。
 *
 * 根因：URL 域名（wallstreetcn.com）、搜索 query 长句（"AI chip news September 2026"）、
 * 搜索算子（site:ithome.com）都会经归因/写入路径混进图谱，稀释强中弱分级。
 * 这里是唯一准入判断：宁枉勿纵——被误拒的话题下次以干净形态出现还能入图，
 * 而污染节点进了图谱要靠清洗脚本捞。
 */

/** URL 形态：协议头 / www. 前缀 / 域名形态（xx.yy[,zz] 后跟边界） */
const URL_LIKE_RE = /^(https?:)?\/\//i;
const WWW_RE = /^www\./i;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+($|[/:?#])/i;
/** 搜索算子前缀（site: / inurl: / intitle: …） */
const SEARCH_OPERATOR_RE = /^\w+\s*:/;
/** 话题长度上限（超长 = 搜索 query 原句） */
const TOPIC_MAX_CHARS = 40;
/** 空白分词上限（多词长句 = query；中文无空格不受影响）。
 * 5 词的 "AI chip news September 2026" 必须拒——合法话题极少超过 4 个英文词 */
const TOPIC_MAX_TOKENS = 4;

/** 判定一个字符串是否可能是有意义的兴趣话题（False 拒绝入图） */
export function isPlausibleTopic(raw: string): boolean {
  const topic = raw.trim();
  if (topic.length === 0 || topic.length > TOPIC_MAX_CHARS) return false;
  if (URL_LIKE_RE.test(topic) || WWW_RE.test(topic)) return false;
  if (DOMAIN_RE.test(topic)) return false;
  if (SEARCH_OPERATOR_RE.test(topic)) return false;
  if (topic.split(/\s+/).length > TOPIC_MAX_TOKENS) return false;
  return true;
}
