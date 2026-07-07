import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, AgentQQMailChannelConfig } from '../types.js';
import { consola } from '../../logger.js';
import { AgentlyCLI } from './cli.js';

const logger = consola.withTag('AgentQQMail');

export class AgentQQMailChannel implements ChannelProtocol {
  readonly id = 'agent-qq-mail' as const;
  readonly name = 'Agent QQ Mail';
  private status: ChannelStatus = 'uninitialized';
  private eventHandler: ((event: ChannelEvent) => void) | null = null;
  private cli: AgentlyCLI = new AgentlyCLI();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  async init(config: AgentQQMailChannelConfig): Promise<void> {
    if (!config.enabled) { this.status = 'disconnected'; return; }
    this.status = 'disconnected';
  }

  async start(): Promise<void> {
    this.status = 'connecting';
    try {
      const email = process.env.AGENTQQMAIL_EMAIL ?? this.cli.getEmail();
      logger.success('Agent QQ Mail connected', { email });
      this.status = 'connected';
      this.emitStatus('connected');
      if (this.eventHandler) this.pollInterval = setInterval(() => this.pollInbox(), 60_000);
    } catch (error) {
      this.status = 'error';
      this.emitStatus('error', String(error));
    }
  }

  async stop(): Promise<void> {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    this.status = 'disconnected';
  }

  async send(content: string): Promise<SendResult> {
    try {
      this.cli.send(content);
      return { success: true, channelId: 'agent-qq-mail', messageId: `mail-${Date.now()}` };
    } catch (error) {
      return { success: false, channelId: 'agent-qq-mail', error: String(error) };
    }
  }

  setEventHandler(handler: (event: ChannelEvent) => void): void { this.eventHandler = handler; }
  getStatus(): ChannelStatus { return this.status; }

  private pollInbox(): void {
    for (const email of this.cli.readRecent(5)) {
      this.eventHandler?.({
        type: 'message',
        channelId: 'agent-qq-mail',
        content: email.body,
        sender: email.from,
        messageId: `email-${email.date}`,
        raw: email,
      });
    }
  }

  private emitStatus(status: ChannelStatus, detail?: string): void {
    this.eventHandler?.({
      type: 'status_change',
      channelId: 'agent-qq-mail',
      status,
      detail,
    });
  }
}

export const agentQQMailChannel = new AgentQQMailChannel();
