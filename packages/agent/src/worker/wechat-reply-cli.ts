/**
 * wechat reply CLI — 微信互动回复的短命 worker 入口（#97）
 *
 * 用法：
 *   bun src/worker/wechat-reply-cli.ts --data-dir <dir> --user-id <wxid> \
 *     --message <text> --pet-name <名> [--secrets-file <path>]
 *
 * 由控制面收 iLink 消息后 spawn（同 feedback-cli 模式）；读租户目录微信
 * 聊天历史做上下文 → LLM 生成一句回复 → stdout 一行 JSON（{ ok, reply }）。
 * 发送由 CP 负责（iLink sendmessage + context_token + 历史落盘）。
 *
 * 退出码：0 = 完成；1 = 失败（stderr 一行 JSON）；2 = 参数错误。
 */

import { readFileSync } from 'fs';
import { initLogger } from '../logger.js';
import { runWechatReply } from './wechat-reply.js';
import type { AgentSecrets } from '../types.js';

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  // #122：worker 日志落盘（agent logger 只写文件；不初始化则日志全丢）
  initLogger();

  const dataDir = parseArg('data-dir');
  const userId = parseArg('user-id');
  const message = parseArg('message');
  const petName = parseArg('pet-name');
  if (!dataDir || !userId || !message || !petName) {
    console.error(
      '用法: wechat-reply-cli.ts --data-dir <dir> --user-id <id> --message <text> --pet-name <名> [--secrets-file <path>]',
    );
    process.exit(2);
  }

  const secretsFile = parseArg('secrets-file');
  let secrets: AgentSecrets | undefined;
  if (secretsFile) {
    secrets = JSON.parse(readFileSync(secretsFile, 'utf-8')) as AgentSecrets;
  }

  const { reply } = await runWechatReply({ dataDir, userId, message, petName, secrets });
  console.log(JSON.stringify({ ok: true, reply }));
  process.exit(0);
}

// 直接执行（非被 import）时跑 main
if (process.argv[1]?.endsWith('wechat-reply-cli.ts')) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
}
