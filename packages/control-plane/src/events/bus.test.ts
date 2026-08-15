/**
 * 事件总线测试（S5，为 S8 SSE 预留）
 *
 * 契约：事件按租户路由——订阅者只收本租户事件；退订后不再收；
 * 单个订阅者抛错不影响其他订阅者与发布方。
 */

import { describe, it, expect, vi } from 'vitest';
import { createEventBus, type TenantEvent } from './bus.js';

describe('租户事件总线', () => {
  it('事件路由到租户：A 的订阅者不收 B 的事件', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('tenant-a', a);
    bus.subscribe('tenant-b', b);

    const ev: TenantEvent = { type: 'worker_started', tenantId: 'tenant-a', petId: 'p1', at: 0 };
    bus.publish('tenant-a', ev);

    expect(a).toHaveBeenCalledWith(ev);
    expect(b).not.toHaveBeenCalled();
  });

  it('同租户多订阅者都收到', () => {
    const bus = createEventBus();
    const s1 = vi.fn();
    const s2 = vi.fn();
    bus.subscribe('tenant-a', s1);
    bus.subscribe('tenant-a', s2);
    bus.publish('tenant-a', { type: 'worker_succeeded', tenantId: 'tenant-a', petId: 'p1', at: 0 });
    expect(s1).toHaveBeenCalledOnce();
    expect(s2).toHaveBeenCalledOnce();
  });

  it('退订后不再收到', () => {
    const bus = createEventBus();
    const s = vi.fn();
    const off = bus.subscribe('tenant-a', s);
    off();
    bus.publish('tenant-a', { type: 'worker_failed', tenantId: 'tenant-a', petId: 'p1', at: 0 });
    expect(s).not.toHaveBeenCalled();
  });

  it('订阅者抛错不传染：其他订阅者照常、发布方不炸', () => {
    const bus = createEventBus();
    const bad = vi.fn(() => {
      throw new Error('subscriber boom');
    });
    const good = vi.fn();
    bus.subscribe('tenant-a', bad);
    bus.subscribe('tenant-a', good);
    expect(() =>
      bus.publish('tenant-a', { type: 'worker_retry', tenantId: 'tenant-a', petId: 'p1', at: 0 }),
    ).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it('无订阅者的租户发布不炸', () => {
    const bus = createEventBus();
    expect(() =>
      bus.publish('nobody', { type: 'worker_started', tenantId: 'nobody', petId: 'p', at: 0 }),
    ).not.toThrow();
  });
});
