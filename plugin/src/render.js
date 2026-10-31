/**
 * 入站消息可读化与脱敏。
 *
 * context_token 是发消息的凭据，不能进事件 meta、日志或模型上下文。
 */

const TEXT = 1;
const IMAGE = 2;
const VOICE = 3;
const FILE = 4;
const VIDEO = 5;

/**
 * 单条 item 的可读文本。
 *
 * `attachment` 是该下标已经下载落盘的媒体（`{ path, mime }`）；
 * 图片下载成功时把本地路径写进正文，让模型有机会用文件工具打开。
 */
export function itemText(item, attachment = null) {
  const type = Number(item?.type);
  switch (type) {
    case TEXT:
      return String(item?.text_item?.text ?? '');
    case VOICE:
      return String(item?.voice_item?.text ?? '[语音]');
    case IMAGE:
      return attachment?.path ? `[图片 ${attachment.path}]` : '[图片]';
    case FILE:
      return item?.file_item?.file_name ? `[文件 ${item.file_item.file_name}]` : '[文件]';
    case VIDEO:
      return '[视频]';
    default:
      return type ? `[消息类型 ${type}]` : '';
  }
}

/** @param attachments - 可选的 `Map<下标, { path, mime }>`。 */
export function messageBody(msg, attachments = null) {
  const parts = (msg?.item_list ?? [])
    .map((item, index) => itemText(item, attachments?.get?.(index) ?? null))
    .filter(Boolean);
  return parts.length ? parts.join(' ') : '[空消息]';
}

export function shortId(value) {
  const id = String(value ?? '');
  if (!id) return '';
  const local = id.includes('@') ? id.slice(0, id.indexOf('@')) : id;
  return local.length > 10 ? `${local.slice(0, 8)}…` : local;
}

function clock(ms, timezone) {
  const value = Number(ms);
  const date = Number.isFinite(value) && value > 0 ? new Date(value) : new Date();
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      ...(timezone ? { timeZone: timezone } : {}),
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 19);
  }
}

export function messageTime(msg) {
  const ms = Number(msg?.create_time_ms);
  if (Number.isFinite(ms) && ms > 0) return ms;
  const seconds = Number(msg?.create_time);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
}

export function renderMessage(msg, timezone = '', attachments = null) {
  const from = shortId(msg?.from_user_id) || '未知';
  return `[微信 ${clock(messageTime(msg), timezone)}] ${from}: ${messageBody(msg, attachments)}`;
}

/**
 * 精简单条 item 用于 meta.raw：只留正文与摘要。
 *
 * 媒体字段（media.encrypt_query_param / media.full_url / media.aes_key /
 * image_item.aeskey）是能换取用户原图与语音的凭证，一律不进事件。
 * 需要它们的调用方应通过 media-ref 存储按 msgId 取用。
 */
function slimItem(item) {
  const type = Number(item?.type);
  switch (type) {
    case TEXT:
      return { type, text: String(item?.text_item?.text ?? '') };
    case VOICE:
      return {
        type,
        text: String(item?.voice_item?.text ?? ''),
        playtime: Number(item?.voice_item?.playtime) || 0,
      };
    case IMAGE:
      return { type, size: Number(item?.image_item?.mid_size) || 0 };
    case FILE:
      return {
        type,
        name: String(item?.file_item?.file_name ?? ''),
        size: Number(item?.file_item?.len) || 0,
      };
    case VIDEO:
      return { type, size: Number(item?.video_item?.video_size) || 0 };
    default:
      return { type };
  }
}

/**
 * 复制一份事件用于 meta.raw，并做白名单式瘦身。
 *
 * 保留：seq、消息 id、时间、发送者短 id、每条 item 的类型与摘要。
 * 丢弃：client_id、to_user_id、session_id、group_id、root_id、parent_id、
 * 各 item 的冗余时间戳与空数组，以及全部媒体凭证。
 */
export function slimRaw(msg) {
  if (!msg || typeof msg !== 'object') return null;
  return {
    seq: Number(msg.seq) || 0,
    msgId: String(msg.message_id ?? ''),
    at: Number(msg.create_time_ms) || 0,
    from: shortId(msg.from_user_id),
    items: (Array.isArray(msg.item_list) ? msg.item_list : []).map(slimItem),
  };
}

/**
 * @deprecated 旧的整包脱敏（只删 context_token，其余原样保留）。
 * 保留导出仅为兼容既有调用方；新代码请用 {@link slimRaw}。
 */
export function sanitizeRaw(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const copy = structuredClone(msg);
  delete copy.context_token;
  return copy;
}
