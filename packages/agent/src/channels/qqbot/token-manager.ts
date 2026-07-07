interface TokenData {
  accessToken: string;
  expiresIn: number;
  obtainedAt: number;
}

export class TokenManager {
  private token: TokenData | null = null;

  constructor(
    private appId: string,
    private clientSecret: string,
  ) {}

  private get isValid(): boolean {
    if (!this.token) return false;
    const elapsed = (Date.now() - this.token.obtainedAt) / 1000;
    return elapsed < this.token.expiresIn - 100;
  }

  async getToken(): Promise<string> {
    if (this.isValid && this.token) {
      return this.token.accessToken;
    }
    return this.fetchToken();
  }

  authHeader(): string {
    return `QQBot ${this.token?.accessToken ?? ''}`;
  }

  private async fetchToken(): Promise<string> {
    const resp = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(
        `QQBot token fetch failed: HTTP ${resp.status} ${(data as { message?: string }).message ?? ''}`,
      );
    }

    const data = (await resp.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      obtainedAt: Date.now(),
    };
    return this.token.accessToken;
  }
}
