import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { consola } from '../../logger.js';

const logger = consola.withTag('page-reader');

/** 正文内容最大字符数 */
const MAX_CONTENT_LENGTH = 5000;

/** 提取的链接最大数量 */
const MAX_LINKS = 10;

/** 抓取网页超时时间（毫秒） */
const FETCH_TIMEOUT_MS = 15_000;

/** 链接信息 */
export interface PageLink {
  text: string;  // 链接文字
  url: string;   // 链接地址
}

/** read_page 工具返回值 */
export interface PageResult {
  url: string;
  title: string;
  content: string;       // 提取后的正文（最多 5000 字）
  links: PageLink[];     // 页面中的链接（最多 10 个）
  error?: string;        // 抓取/解析失败时的错误信息
}

/**
 * 将相对 URL 转换为绝对 URL
 */
function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * 从 DOM 中提取有效链接
 */
function extractLinks(document: Document, baseUrl: string): PageLink[] {
  const anchors = document.querySelectorAll('a[href]');
  const links: PageLink[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors) {
    if (links.length >= MAX_LINKS) break;

    const href = anchor.getAttribute('href');
    if (!href) continue;

    // 跳过锚点、javascript、mailto 等
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      continue;
    }

    const absoluteUrl = resolveUrl(baseUrl, href);
    if (!absoluteUrl) continue;

    // 只保留 http/https
    if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
      continue;
    }

    // 去重
    if (seen.has(absoluteUrl)) continue;
    seen.add(absoluteUrl);

    const text = anchor.textContent?.trim() || '';
    if (!text) continue;

    links.push({ text: text.slice(0, 100), url: absoluteUrl });
  }

  return links;
}

/**
 * 读取网页内容
 *
 * 流程：fetch HTML → Readability 提取正文 → 提取链接
 * 失败时返回带 error 字段的结果，不抛出异常（不中断 ReAct Loop）
 */
export async function readPage(url: string): Promise<PageResult> {
  logger.info('读取网页', { url });

  let html: string;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CyberStrayBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      logger.warn('网页抓取失败', { url, status: response.status });
      return {
        url,
        title: '',
        content: '',
        links: [],
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    html = await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('网页请求异常', { url, error: message });
    return {
      url,
      title: '',
      content: '',
      links: [],
      error: `请求失败: ${message}`,
    };
  }

  try {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // 提取链接（在 Readability 修改 DOM 之前）
    const links = extractLinks(document, url);

    // 使用 Readability 提取正文
    const reader = new Readability(document);
    const article = reader.parse();

    const title = article?.title ?? document.title ?? '';
    const rawContent = article?.textContent ?? '';

    // 清理多余空白，限制长度
    const content = rawContent
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CONTENT_LENGTH);

    logger.success('网页读取完成', {
      url,
      title,
      contentLength: content.length,
      linksCount: links.length,
    });

    return { url, title, content, links };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('网页解析失败', { url, error: message });
    return {
      url,
      title: '',
      content: '',
      links: [],
      error: `解析失败: ${message}`,
    };
  }
}
