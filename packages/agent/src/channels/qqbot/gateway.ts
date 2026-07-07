import WebSocket from 'isomorphic-ws';
import { consola } from '../../logger.js';

const logger = consola.withTag('QQBot:gateway');
const GATEWAY_INTENTS = 1107296260;

export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export type RawEventHandler = (payload: GatewayPayload) => void;

export interface GatewayState {
  sessionId: string | null;
  lastSeq: number | null;
  connected: boolean;
}

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private heartbeatInterval = 45000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onEvent: RawEventHandler | null = null;
  private onStateChange: ((state: GatewayState) => void) | undefined = undefined;

  state: GatewayState = { sessionId: null, lastSeq: null, connected: false };

  constructor(private accessToken: string) {}

  setEventHandlers(onEvent: RawEventHandler, onStateChange?: (state: GatewayState) => void): void {
    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
  }

  async connect(): Promise<void> {
    const resp = await fetch('https://api.sgroup.qq.com/gateway', {
      headers: { 'Authorization': `QQBot ${this.accessToken}` },
    });
    if (!resp.ok) throw new Error(`Failed to get gateway URL: HTTP ${resp.status}`);
    const { url } = (await resp.json()) as { url: string };
    await this.connectWebSocket(url);
  }

  private connectWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.running = true;
      let identified = false;

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data as string) as GatewayPayload;
          this.state.lastSeq = payload.s ?? this.state.lastSeq;

          switch (payload.op) {
            case 10: {
              const d = payload.d as { heartbeat_interval: number };
              this.heartbeatInterval = d.heartbeat_interval;
              this.sendIdentify();
              this.startHeartbeat();
              break;
            }
            case 0: {
              if (payload.t === 'READY') {
                const d = payload.d as { session_id: string };
                this.state.sessionId = d.session_id;
                this.state.connected = true;
                identified = true;
                this.emitStateChange();
                resolve();
              } else if (payload.t === 'RESUMED') {
                this.state.connected = true;
              } else if (this.onEvent) {
                this.onEvent(payload);
              }
              break;
            }
            case 7:
              this.disconnect();
              break;
            case 9:
              this.state.sessionId = null;
              reject(new Error('Invalid session'));
              break;
            case 11:
              break;
          }
        } catch (err) {
          logger.error('Gateway payload error', { error: String(err) });
        }
      };

      this.ws.onclose = () => {
        this.state.connected = false;
        this.stopHeartbeat();
        this.emitStateChange();
        if (!identified) reject(new Error('WebSocket closed before READY'));
      };

      this.ws.onerror = () => {
        if (!identified) reject(new Error('WebSocket connection error'));
      };
    });
  }

  private sendIdentify(): void {
    this.ws?.send(JSON.stringify({
      op: 2,
      d: {
        token: `QQBot ${this.accessToken}`,
        intents: GATEWAY_INTENTS,
        shard: [0, 1],
        properties: { $os: 'linux', $browser: 'cyber-stray', $device: 'cyber-stray' },
      },
    }));
  }

  sendResume(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      op: 6,
      d: { token: `QQBot ${this.accessToken}`, session_id: this.state.sessionId, seq: this.state.lastSeq },
    }));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.running) {
        this.ws.send(JSON.stringify({ op: 1, d: this.state.lastSeq }));
      }
    }, this.heartbeatInterval * 0.8);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  disconnect(): void {
    this.running = false;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.state.connected = false;
    this.emitStateChange();
  }

  private emitStateChange(): void { this.onStateChange?.(this.state); }
}
