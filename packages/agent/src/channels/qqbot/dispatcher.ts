import type { ChannelEvent } from '../types.js';
import type { GatewayPayload } from './gateway.js';

export class EventDispatcher {
  constructor(private handler: (event: ChannelEvent) => void) {}

  dispatch(payload: GatewayPayload): void {
    switch (payload.t) {
      case 'C2C_MESSAGE_CREATE': {
        const d = payload.d as { author: { id: string }; content: string; id: string };
        this.handler({
          type: 'message',
          channelId: 'qqbot',
          content: d.content,
          sender: d.author.id,
          messageId: d.id,
          raw: d,
        });
        break;
      }
      case 'GROUP_AT_MESSAGE_CREATE': {
        const d = payload.d as {
          group_openid: string;
          author: { id: string; member_openid?: string };
          content: string;
          id: string;
        };
        this.handler({
          type: 'message',
          channelId: 'qqbot',
          content: d.content,
          sender: d.author.member_openid ?? d.author.id,
          messageId: d.id,
          raw: d,
        });
        break;
      }
      case 'FRIEND_ADD':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'friend_add',
          userId: (payload.d as { openid: string }).openid,
          raw: payload.d,
        });
        break;
      case 'FRIEND_DEL':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'friend_delete',
          userId: (payload.d as { openid: string }).openid,
          raw: payload.d,
        });
        break;
      case 'GROUP_ADD_ROBOT':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'group_join',
          groupId: (payload.d as { group_openid: string }).group_openid,
          raw: payload.d,
        });
        break;
      case 'GROUP_DEL_ROBOT':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'group_leave',
          groupId: (payload.d as { group_openid: string }).group_openid,
          raw: payload.d,
        });
        break;
    }
  }
}
