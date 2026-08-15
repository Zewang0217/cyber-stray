import { describe, test, expect } from 'vitest';
import { deriveTitle, deriveSummary, buildSpeakRecord } from './history-record.js';

describe('deriveTitle', () => {
  test('取第一行作为标题', () => {
    expect(deriveTitle('Rust 1.90 发布\n带来了新的借用检查器', 'share')).toBe('Rust 1.90 发布');
  });

  test('剥掉 markdown 标记', () => {
    expect(deriveTitle('## **重磅** 更新', 'article')).toBe('重磅 更新');
  });

  test('剥掉行内 URL', () => {
    expect(deriveTitle('看这个 https://example.com/a/b 挺有意思', 'share')).toBe('看这个 挺有意思');
  });

  test('跳过纯链接行取下一行', () => {
    expect(deriveTitle('https://example.com\n真正的标题', 'share')).toBe('真正的标题');
  });

  test('超长中文按字符截断并加省略号', () => {
    const title = deriveTitle('测'.repeat(50), 'article');
    expect([...title]).toHaveLength(41);
    expect(title.endsWith('…')).toBe(true);
  });

  test('内容为空时回退到类型名', () => {
    expect(deriveTitle('   \n  ', 'nonsense')).toBe('碎碎念');
    expect(deriveTitle('https://example.com', 'share')).toBe('分享');
  });
});

describe('deriveSummary', () => {
  test('折叠换行与多余空白', () => {
    expect(deriveSummary('第一行\n\n第二行   第三行')).toBe('第一行 第二行 第三行');
  });

  test('超长内容截断到 120 字', () => {
    const summary = deriveSummary('字'.repeat(200));
    expect([...summary]).toHaveLength(121);
  });
});

describe('buildSpeakRecord', () => {
  const ts = '2026-07-30T10:00:00.000Z';

  test('保留原始字段并补齐结构化字段', () => {
    const record = buildSpeakRecord(
      'Rust 1.90 发布\nhttps://blog.rust-lang.org/x',
      'share',
      true,
      ts,
      { mood: 'excited', messageId: 'om_123' },
    );

    expect(record.content).toBe('Rust 1.90 发布\nhttps://blog.rust-lang.org/x');
    expect(record.type).toBe('share');
    expect(record.pushed).toBe(true);
    expect(record.timestamp).toBe(ts);
    expect(record.title).toBe('Rust 1.90 发布');
    expect(record.url).toBe('https://blog.rust-lang.org/x');
    expect(record.mood).toBe('excited');
    expect(record.messageId).toBe('om_123');
  });

  test('无链接时不写 url 字段', () => {
    const record = buildSpeakRecord('今天天气不错', 'nonsense', true, ts);
    expect('url' in record).toBe(false);
  });

  test('门控拦截时标记 gated 与评分', () => {
    const record = buildSpeakRecord('凑数内容', 'nonsense', false, ts, {
      gated: true,
      gateScore: 0.31,
    });

    expect(record.pushed).toBe(false);
    expect(record.gated).toBe(true);
    expect(record.gateScore).toBe(0.31);
  });

  test('未拦截时不写 gated 字段', () => {
    const record = buildSpeakRecord('正常内容', 'share', true, ts, { gateScore: 0.8 });
    expect('gated' in record).toBe(false);
    expect(record.gateScore).toBe(0.8);
  });
});

describe('S8 推送理由', () => {
  const ts = '2026-08-15T10:00:00.000Z';

  test('gateReasons 落盘（推送理由随记录持久化）', () => {
    const record = buildSpeakRecord('AI 芯片新进展', 'article', true, ts, {
      gateScore: 0.82,
      gateReasons: ['兴趣相关度=0.90', '用户偏好=0.80', '内容质量=0.70'],
    });

    expect(record.gateReasons).toEqual(['兴趣相关度=0.90', '用户偏好=0.80', '内容质量=0.70']);
  });

  test('无理由时不写字段（旧记录兼容）', () => {
    const record = buildSpeakRecord('碎碎念', 'nonsense', true, ts);
    expect('gateReasons' in record).toBe(false);
  });
});
