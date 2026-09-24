/**
 * OIDC 登录流 state 存储（CSRF 防护）
 *
 * 登录时生成随机 state + nonce，回调时校验并立即删除（一次性）。
 * 无服务端 session 存储（stateless 取向）：单进程内存 Map + TTL 过期；
 * 多实例共享前（Redis/共享存储，与 Postgres 同一触发点）维持现状。
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟

interface StateEntry {
  nonce: string;
  verifier: string;
  /** 邀请 raw token（#301）：/login?invite= 携带，穿越 OIDC 往返在 callback 消费 */
  inviteToken?: string;
  createdAt: number;
}

export class StateStore {
  private states = new Map<string, StateEntry>();

  /** 登记一个 OIDC 登录 state（oidc 层生成 state/nonce/verifier；inviteToken 可选携带） */
  set(state: string, nonce: string, verifier: string, inviteToken?: string): void {
    this.sweepExpired();
    this.states.set(state, { nonce, verifier, inviteToken, createdAt: Date.now() });
  }

  /**
   * 校验并消费 state。有效返回其 { nonce, verifier }，否则返回 null。
   * 无论结果如何都删除（一次性，防重放）。
   */
  consume(state: string): { nonce: string; verifier: string; inviteToken?: string } | null {
    const entry = this.states.get(state);
    this.states.delete(state);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
    return { nonce: entry.nonce, verifier: entry.verifier, inviteToken: entry.inviteToken };
  }

  /** 惰性清理过期条目：/login 是未认证端点，防弃置登录无限堆积内存 */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [state, entry] of this.states) {
      if (now - entry.createdAt > STATE_TTL_MS) {
        this.states.delete(state);
      }
    }
  }
}
