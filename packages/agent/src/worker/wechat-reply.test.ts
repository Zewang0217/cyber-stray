/**
 * 微信回复生成测试（#97）——mock LLM + 历史上下文
 *
 * 契约：
 * - buildReplyPrompt：system 含宠物人设；user 含历史 + 主人最新消息
 * - runWechatReply：注入 LLM → 返回 trim 后的回复
 * - readWechatHistory：读租户目录 chat-<userId>.jsonl（缺失 = 空）
 * - 空回复 → 抛错（不兜底）
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildReplyPrompt,
  readWechatHistory,
  runWechatReply,
  safeUserId,
} from './wechat-reply.js';

describe('buildReplyPrompt', () => {
  it('system 含宠物名与人设；user 含历史 + 最新消息', () => {
    const { system, user } = buildReplyPrompt({
      petName: '街溜子',
      history: [
        { role: 'user', text: '你好', at: '2026-08-20T00:00:00Z' },
        { role: 'bot', text: '嗨!今天又逛到什么有趣的', at: '2026-08-20T00:01:00Z' },
      ],
      message: '最近在干嘛',
    });
    expect(system).toContain('街溜子');
    expect(user).toContain('主人: 你好');
    expect(user).toContain('街溜子: 嗨!');
    expect(user).toContain('主人最新消息: 最近在干嘛');
  });

  it('无历史时不渲染历史段', () => {
    const { user } = buildReplyPrompt({ petName: '街溜子', history: [], message: 'hi' });
    expect(user).not.toContain('最近的聊天');
    expect(user).toContain('主人最新消息: hi');
  });
});

describe('readWechatHistory', () => {
  it('读最近 N 条；文件缺失 = 空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-reply-'));
    try {
      const history = join(dir, 'wechat');
      mkdirSync(history, { recursive: true });
      writeFileSync(
        join(history, `chat-${safeUserId('owner@im.wechat')}.jsonl`),
        [
          JSON.stringify({ role: 'user', text: '一', at: '1' }),
          JSON.stringify({ role: 'bot', text: '二', at: '2' }),
          JSON.stringify({ role: 'user', text: '三', at: '3' }),
        ].join('\n'),
        'utf8',
      );
      const lines = await readWechatHistory(dir, 'owner@im.wechat', 2);
      expect(lines.map((l) => l.text)).toEqual(['二', '三']);
      expect(await readWechatHistory(dir, 'nobody@im.wechat')).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runWechatReply', () => {
  it('注入 LLM：返回 trim 后的回复；历史作为上下文传入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-reply2-'));
    try {
      const llm = vi.fn(async () => '  好的!我最近在研究黑洞。  ');
      const { reply } = await runWechatReply({
        dataDir: dir,
        userId: 'owner@im.wechat',
        message: '在吗',
        petName: '街溜子',
        llm,
      });
      expect(reply).toBe('好的!我最近在研究黑洞。');
      expect(llm).toHaveBeenCalledTimes(1);
      const [system, user] = llm.mock.calls[0] as unknown as [string, string];
      expect(system).toContain('街溜子');
      expect(user).toContain('在吗');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('LLM 返回空 → 抛错（不兜底）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-reply3-'));
    try {
      await expect(
        runWechatReply({
          dataDir: dir,
          userId: 'owner@im.wechat',
          message: '在吗',
          petName: '街溜子',
          llm: async () => '   ',
        }),
      ).rejects.toThrow('空回复');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
