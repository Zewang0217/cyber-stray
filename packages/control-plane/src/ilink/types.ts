/**
 * iLink（微信 ClawBot）协议类型（#97）
 *
 * 字段名与 Tencent/openclaw-weixin（官方参考实现）src/api/types.ts 对齐。
 * 协议 = JSON over HTTP，无 WebSocket；bytes 字段在 JSON 里是 base64 字符串。
 * 真实端点带 /ilink/bot/ 前缀，基座默认 https://ilinkai.weixin.qq.com。
 *
 * 可信度：官方源码（openclaw-weixin）+ 生产适配器（hermes weixin.py）交叉
 * 验证；本机无法真实联调，接入生产前按"部署后验证项"过一遍真实端点。
 */

/** 每个 CGI 请求附带的 base_info（观察用，非鉴权） */
export interface IlinkBaseInfo {
  /** 通道版本标识（如 '2.0.0'） */
  channel_version?: string;
  /** UA 式 bot 自我标识 */
  bot_agent?: string;
}

/** 消息条目（item_list 元素） */
export interface IlinkMessageItem {
  /** 1=文本 2=图片 3=语音 4=文件 5=视频 11=TOOL_CALL_START 12=TOOL_CALL_RESULT */
  type?: number;
  text_item?: { text?: string };
  image_item?: { media?: IlinkCdnMedia; url?: string; mid_size?: number; aeskey?: string };
  voice_item?: { media?: IlinkCdnMedia; encode_type?: number; text?: string; playtime?: number };
  file_item?: { media?: IlinkCdnMedia; file_name?: string; md5?: string; len?: string };
  video_item?: { media?: IlinkCdnMedia; video_size?: number; thumb_media?: IlinkCdnMedia };
  msg_id?: string;
  create_time_ms?: number;
  is_completed?: boolean;
}

/** CDN 媒体引用（aes_key 在 JSON 里是 base64(hex 原始字节)） */
export interface IlinkCdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

/** 统一消息（proto WeixinMessage） */
export interface IlinkMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number; // 1=USER 2=BOT
  message_state?: number; // 0=NEW 1=GENERATING 2=FINISH
  item_list?: IlinkMessageItem[];
  /** 入站消息携带；回复时原样回传（24h 有效会话内） */
  context_token?: string;
  run_id?: string;
}

/** getupdates 长轮询响应 */
export interface IlinkGetUpdatesResp {
  ret?: number;
  /** 错误码（如 -14 = 会话过期） */
  errcode?: number;
  errmsg?: string;
  msgs?: IlinkMessage[];
  /** 游标：原样缓存并随下次请求带回 */
  get_updates_buf?: string;
  /** 服务端建议的下次长轮询超时（ms） */
  longpolling_timeout_ms?: number;
}

/** sendmessage 响应（HTTP 200 空 body 或 {} 即成功） */
export interface IlinkSendMessageResp {
  ret?: number;
  errmsg?: string;
}

/** get_bot_qrcode 响应 */
export interface IlinkQrStartResp {
  /** hex token（get_qrcode_status 的查询键） */
  qrcode: string;
  /** 可扫码的完整 URL（前端 <img src> 直接展示） */
  qrcode_img_content: string;
}

/** get_qrcode_status 状态枚举（比文档丰富，openclaw login-qr.ts 同款） */
export type IlinkQrStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'
  | 'need_verifycode'
  | 'verify_code_blocked'
  | 'binded_redirect';

/** get_qrcode_status 响应（服务端 hold 约 35s 长轮询） */
export interface IlinkQrStatusResp {
  /** 错误码（限流 ret=-2 / 会话过期 errcode=-14 等；成功时缺省） */
  ret?: number;
  errcode?: number;
  errmsg?: string;
  status: IlinkQrStatus;
  /** confirmed 时返回：后续 Bearer 凭证 */
  bot_token?: string;
  /** confirmed 时返回：租户 bot 账号 ID */
  ilink_bot_id?: string;
  /** confirmed 时返回：基座 URL（必须用它，可能 ≠ 默认） */
  baseurl?: string;
  /** confirmed 时返回：扫码主人的微信身份（pairing 白名单锚点） */
  ilink_user_id?: string;
  /** scaned_but_redirect 时返回：轮询需切到 https://<host> */
  redirect_host?: string;
}

/** getconfig 响应（typing_ticket 用于 sendtyping） */
export interface IlinkGetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

/** sendtyping 请求/响应 */
export interface IlinkSendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  /** 1=typing（默认）2=cancel */
  status?: number;
}
export interface IlinkSendTypingResp {
  ret?: number;
  errmsg?: string;
}

/** getuploadurl 请求/响应（媒体 CDN 流程，首版文本后置） */
export interface IlinkGetUploadUrlReq {
  filekey?: string;
  media_type?: number; // 1=图片 2=视频 3=文件 4=语音
  to_user_id?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  aeskey?: string;
}
export interface IlinkGetUploadUrlResp {
  ret?: number;
  errmsg?: string;
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

/** sendmessage 请求（buildText 形态） */
export interface IlinkSendMessageReq {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number; // 2=BOT
    message_state: number; // 2=FINISH
    item_list: IlinkMessageItem[];
    context_token?: string;
    run_id?: string;
  };
}
