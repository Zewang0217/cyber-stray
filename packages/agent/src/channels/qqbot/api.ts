import { consola } from '../../logger.js';

const logger = consola.withTag('QQBot:api');
const BASE_URL = 'https://api.sgroup.qq.com';

export interface SendMessageResult {
  id: string;
  timestamp: string;
}

export class MessageApi {
  constructor(
    private getToken: () => Promise<string>,
  ) {}

  async sendC2CText(openid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/users/${openid}/messages`, {
      content,
      msg_type: 0,
    });
  }

  async sendC2CMarkdown(openid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/users/${openid}/messages`, {
      msg_type: 2,
      markdown: { content },
    });
  }

  async sendGroupText(groupOpenid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/groups/${groupOpenid}/messages`, {
      content,
      msg_type: 0,
    });
  }

  async sendGroupMarkdown(groupOpenid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/groups/${groupOpenid}/messages`, {
      msg_type: 2,
      markdown: { content },
    });
  }

  private async post(path: string, body: Record<string, unknown>): Promise<SendMessageResult> {
    const token = await this.getToken();
    const url = `${BASE_URL}${path}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await resp.json()) as { id?: string; timestamp?: string; code?: number; message?: string };

    if (!resp.ok || data.code) {
      const code = data.code ?? resp.status;
      throw new Error(`QQBot API error: code=${code} ${data.message ?? ''}`);
    }

    logger.debug('sent message', { path, id: data.id });

    return { id: data.id ?? '', timestamp: data.timestamp ?? '' };
  }
}
