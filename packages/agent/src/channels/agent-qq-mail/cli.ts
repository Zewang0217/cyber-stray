import { execSync } from 'child_process';
import { consola } from '../../logger.js';

const logger = consola.withTag('AgentlyCLI');

export interface EmailMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
}

export class AgentlyCLI {
  send(content: string): void {
    try {
      execSync(`agently-cli send --body "${content.replace(/"/g, '\\"')}"`, {
        timeout: 30_000,
        encoding: 'utf-8',
      });
      logger.info('email sent via agently-cli');
    } catch (error) {
      logger.error('agently-cli send failed', { error: String(error) });
      throw error;
    }
  }

  getEmail(): string {
    const output = execSync('agently-cli +me', { timeout: 10_000, encoding: 'utf-8' });
    return output.trim();
  }

  readRecent(count: number = 5): EmailMessage[] {
    try {
      const output = execSync(`agently-cli read --count ${count} --format json`, {
        timeout: 30_000,
        encoding: 'utf-8',
      });
      return JSON.parse(output) as EmailMessage[];
    } catch (error) {
      logger.warn('agently-cli read failed', { error: String(error) });
      return [];
    }
  }
}
