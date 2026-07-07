/**
 * 飞书卡片消息构建
 *
 * 生成带交互按钮的卡片消息格式
 *
 * 注意：飞书自定义机器人 Webhook 不支持卡片按钮回调，
 * 因此卡片只展示内容，按钮提示仅供参考。
 * 实际反馈通过表情互动（👍👎）实现。
 *
 * @deprecated Moved to channels/feishu/. Will be deleted in Phase 6.
 */

/** 卡片消息结构 */
export interface FeishuCard {
  msg_type: 'interactive';
  card: FeishuCardContent;
}

/** 卡片内容 */
export interface FeishuCardContent {
  config: {
    wide_screen_mode: boolean;
  };
  header: {
    title: {
      tag: 'plain_text';
      content: string;
    };
    template: string;
  };
  elements: FeishuElement[];
}

/** 卡片元素 */
export type FeishuElement =
  | FeishuMarkdownElement
  | FeishuHrElement
  | FeishuNoteElement;

/** Markdown 元素 */
export interface FeishuMarkdownElement {
  tag: 'markdown';
  content: string;
}

/** 分隔线元素 */
export interface FeishuHrElement {
  tag: 'hr';
}

/** 备注元素 */
export interface FeishuNoteElement {
  tag: 'note';
  elements: FeishuPlainText[];
}

/** 纯文本元素 */
export interface FeishuPlainText {
  tag: 'plain_text';
  content: string;
}

/**
 * 构建卡片消息
 *
 * @param content 主内容（支持 Markdown）
 * @param messageId 消息 ID（用于关联反馈）
 * @returns 卡片消息 JSON
 */
export function buildFeedbackCard(
  content: string,
  _messageId?: string
): FeishuCard {
  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: '🐱 赛博街溜子',
        },
        template: 'blue',
      },
      elements: [
        // 内容
        {
          tag: 'markdown',
          content,
        } satisfies FeishuMarkdownElement,
        // 分隔线
        {
          tag: 'hr',
        } satisfies FeishuHrElement,
        // 提示：通过表情反馈
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '💡 用表情回应我：👍 喜欢 | 👎 不喜欢',
            },
          ],
        } satisfies FeishuNoteElement,
      ],
    },
  };
}

/**
 * 构建简单的纯文本消息（兼容不支持卡片的场景）
 */
export function buildSimpleText(content: string): { msg_type: 'text'; content: { text: string } } {
  return {
    msg_type: 'text',
    content: { text: content },
  };
}