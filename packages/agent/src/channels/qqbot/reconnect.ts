import { consola } from '../../logger.js';

const logger = consola.withTag('QQBot:reconnect');
const BACKOFF = [1, 2, 5, 10, 30, 60];
const MAX_ATTEMPTS = 100;
const FATAL_CODES = new Set([4914, 4915]);

export class ReconnectManager {
  private attemptCount = 0;

  constructor(private connectFn: () => Promise<void>) {}

  reset(): void { this.attemptCount = 0; }

  async retryConnect(): Promise<void> {
    for (this.attemptCount = 0; this.attemptCount < MAX_ATTEMPTS; this.attemptCount++) {
      const delay = BACKOFF[Math.min(this.attemptCount, BACKOFF.length - 1)]!;
      if (this.attemptCount > 0) {
        logger.info(`Reconnect attempt ${this.attemptCount} after ${delay}s`);
        await sleep(delay * 1000);
      }
      try {
        await this.connectFn();
        this.reset();
        return;
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code && FATAL_CODES.has(code)) {
          throw new Error(`Fatal: QQ Bot ${code}`);
        }
      }
    }
    throw new Error(`Max reconnect attempts reached`);
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
