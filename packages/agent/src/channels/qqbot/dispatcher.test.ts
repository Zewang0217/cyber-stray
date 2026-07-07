import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from './dispatcher.js';
import type { GatewayPayload } from './gateway.js';

function makePayload(t: string, d: unknown): GatewayPayload {
  return { op: 0, d, s: 1, t };
}

describe('EventDispatcher', () => {
  it('dispatches C2C_MESSAGE_CREATE as message event', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('C2C_MESSAGE_CREATE', {
      author: { id: 'user-abc' },
      content: 'Hello bot!',
      id: 'msg-001',
    }));

    expect(handler).toHaveBeenCalledWith({
      type: 'message',
      channelId: 'qqbot',
      content: 'Hello bot!',
      sender: 'user-abc',
      messageId: 'msg-001',
      raw: expect.any(Object),
    });
  });

  it('dispatches GROUP_AT_MESSAGE_CREATE with member_openid as sender', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('GROUP_AT_MESSAGE_CREATE', {
      group_openid: 'group-xyz',
      author: { id: 'owner-id', member_openid: 'member-123' },
      content: '@bot hello',
      id: 'msg-002',
    }));

    expect(handler).toHaveBeenCalledWith({
      type: 'message',
      channelId: 'qqbot',
      content: '@bot hello',
      sender: 'member-123',
      messageId: 'msg-002',
      raw: expect.any(Object),
    });
  });

  it('dispatches GROUP_AT_MESSAGE_CREATE with author.id when member_openid missing', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('GROUP_AT_MESSAGE_CREATE', {
      group_openid: 'group-xyz',
      author: { id: 'owner-id' },
      content: '@bot hi',
      id: 'msg-003',
    }));

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'owner-id',
    }));
  });

  it('dispatches FRIEND_ADD as relationship event', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('FRIEND_ADD', {
      openid: 'new-friend-456',
    }));

    expect(handler).toHaveBeenCalledWith({
      type: 'relationship',
      channelId: 'qqbot',
      action: 'friend_add',
      userId: 'new-friend-456',
      raw: expect.any(Object),
    });
  });

  it('dispatches FRIEND_DEL as relationship event', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('FRIEND_DEL', {
      openid: 'ex-friend-789',
    }));

    expect(handler).toHaveBeenCalledWith({
      type: 'relationship',
      channelId: 'qqbot',
      action: 'friend_delete',
      userId: 'ex-friend-789',
      raw: expect.any(Object),
    });
  });

  it('dispatches GROUP_ADD_ROBOT as relationship event', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('GROUP_ADD_ROBOT', {
      group_openid: 'group-new-abc',
    }));

    expect(handler).toHaveBeenCalledWith({
      type: 'relationship',
      channelId: 'qqbot',
      action: 'group_join',
      groupId: 'group-new-abc',
      raw: expect.any(Object),
    });
  });

  it('dispatches GROUP_DEL_ROBOT as relationship event', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('GROUP_DEL_ROBOT', {
      group_openid: 'group-gone-def',
    }));

    expect(handler).toHaveBeenCalledWith({
      type: 'relationship',
      channelId: 'qqbot',
      action: 'group_leave',
      groupId: 'group-gone-def',
      raw: expect.any(Object),
    });
  });

  it('ignores unknown event types', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch(makePayload('UNKNOWN_EVENT', { data: 'ignored' }));

    expect(handler).not.toHaveBeenCalled();
  });
});
