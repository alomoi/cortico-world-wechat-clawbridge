/**
 * 微信 ClawBridge World（cortico-world-clawbot 的分支）。
 *
 * 一个 iLink 1v1 通道：扫码绑定、长轮询收消息、`clawbridge_send` 回复。
 * 入站事件走 `clawbridge.message`，连接状态走 `clawbridge.connection`。
 * 语音用微信的转写文本；图片会下载解密后落盘，正文带本地路径。
 * 事件 meta 只保留精简信封，媒体凭证存在 `<dataDir>/clawbot/media/`。
 */
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';
import { fetch as undiciFetch } from 'undici';

import {
  DEFAULT_BASE_URL,
  MAX_TEXT_CHARS,
  fetchQrCode,
  pollQrStatus,
} from './api.js';
import { ILinkDriver } from './driver.js';
import { closeDispatcher, createDispatcher } from './network.js';
import { ILinkStore } from './store.js';
import { MediaRefStore, captureMediaItems, imageBlobsFor } from './media-ref.js';
import { DEFAULT_MAX_BYTES } from './media.js';
import { DATA_ID, EVENT_MESSAGE, ID, configGroup, text } from './config.js';
import { messageTime, renderMessage, shortId, slimRaw } from './render.js';
import { countChars, describeSendError, failedReceipt, sentReceipt } from './receipt.js';
import { limitSegments, splitLongText, splitScript } from './segments.js';
import { isInsideAnyResolved } from './paths.js';
import { cleanOldFiles } from './cleanup.js';
import { listRecentMedia } from './media-list.js';
import { DEFAULT_MAX_EDGE, DEFAULT_QUALITY, downscaleForModel } from './resize.js';
import { findSticker, stickerNameOf } from './stickers.js';
import { isKnownWord, resolveEmoji } from './emoji-map.js';

const ENV_PROMPT = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const msgOf = (err) => (err instanceof Error ? err.message : String(err));

/** 图片引用失败的短原因（进回执）。 */
function imageErrorText(err) {
  switch (err?.code) {
    case 'denied': return '路径不允许(仅数据目录)';
    case 'too-large': return '图片过大';
    case 'not-file': return '不是文件';
    case 'missing-blob': return '图片句柄已失效';
    case 'sticker-missing': return `表情「${err?.name ?? ''}」不在素材表`;
    case 'empty': return '空图片引用';
    case 'ENOENT': return '文件不存在';
    default: return '图片读取失败';
  }
}

/** 文件引用失败的短原因（进回执）。 */
function fileErrorText(err) {
  switch (err?.code) {
    case 'denied': return '路径不允许(仅工作区)';
    case 'too-large': return '文件过大';
    case 'not-file': return '不是文件';
    case 'empty':
    case 'empty-file': return '空文件';
    case 'ENOENT': return '文件不存在';
    default: return '文件读取失败';
  }
}

/** `clawbridge_events` 的默认返回条数；调用方可用 limit 覆盖（上限 100）。 */
const DEFAULT_EVENT_LIMIT = 10;
/** 单个文件/视频的默认上限（兆字节），与配置默认一致。 */
const DEFAULT_MAX_FILE_MB = 100;
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kindMatcher(pattern) {
  const value = String(pattern ?? '').trim();
  if (!value) return () => true;
  const re = new RegExp(`^${value.split('*').map(escapeRegExp).join('.*')}$`, 'i');
  return (kind) => re.test(String(kind ?? ''));
}

function parseIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? false : new Date(ms).toISOString();
}

export const CLAWBOT_TOOL_DECLS = [
  {
    name: 'clawbridge_send',
    tags: ['write'],
    description:
      'Send a WeChat reply through the ClawBot channel. It goes to the person whose inbound message '
      + 'arrived most recently. The channel is 1:1 and reply-only, so a context token from that message '
      + 'must still be valid. Use 【…】 to start a new WeChat message (split) and <…> to place an expression '
      + 'inline without splitting; markers themselves are not sent. Messages go out in order with a short gap. '
      + 'Images go out after the text, in the order given. The receipt says how many went out or why not.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          maxLength: MAX_TEXT_CHARS,
          description: `Reply text, up to ${MAX_TEXT_CHARS} characters per message. 【…】 starts a new message.`,
        },
        images: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Images to send after the text, each one of: a [blob …] handle from your context (log:… or mem:…) '
            + 'to send back a picture you received or remember; "sticker:<name>" for a picture sticker from the '
            + 'sticker library; or an absolute path inside the bridge blob folder (…/clawbot/blobs) or your own '
            + 'workspace (…/workspace). Anything else is refused.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Files to send after the text and images. Only available when file transfer is enabled in the plugin '
            + 'settings. Each one must be an absolute path inside your own workspace (…/workspace); files you '
            + 'received cannot be sent back, copy them into your workspace first. Anything else is refused.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'clawbridge_status',
    tags: ['read'],
    description:
      'Show the WeChat ClawBot connection, bound account, last inbound message time and last error.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'clawbridge_events',
    tags: ['read'],
    description:
      'Read archived WeChat events by kind and time. kind supports * (for example message/*). '
      + 'Returns compact records by default; set raw true only when you need the slimmed envelope.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Event kind or glob: message/private.' },
        since: { type: 'string', description: 'ISO 8601 lower bound, inclusive.' },
        until: { type: 'string', description: 'ISO 8601 upper bound, inclusive.' },
        limit: { type: 'integer', description: 'Maximum events to return (1-100, default 10).' },
        raw: {
          type: 'boolean',
          description: 'Include the slimmed envelope (seq, msgId, time, sender, item summaries). Default false.',
        },
      },
    },
  },
];

export class ClawbotWorld {
  #cfg;
  #dataDir;
  #timezone;
  #fetchOverride;
  #fetchImpl;
  #dispatcher = null;
  #apiBaseUrl;
  #store;
  #mediaRefs;
  #blobsDir;
  #host = null;
  #driver = null;
  #auth = null;
  #started = false;
  #startedAt = '';
  #expired = false;
  #lastError = '';
  #lastUserId = '';
  #lastMessageAt = '';
  #contextCount = 0;
  #login = null;
  #loginLoop = null;
  #loginAbort = null;

  constructor(opts = {}) {
    this.id = ID;
    this.#cfg = opts.cfg ?? {};
    this.#dataDir = opts.dataDir ?? process.cwd();
    this.#timezone = opts.timezone ?? '';
    this.#fetchOverride = opts.fetchImpl ?? null;
    this.#fetchImpl = this.#fetchOverride ?? globalThis.fetch;
    this.#apiBaseUrl = String(opts.apiBaseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#store = new ILinkStore(join(this.#dataDir, DATA_ID));
    this.#mediaRefs = new MediaRefStore(join(this.#dataDir, DATA_ID, 'media'));
    this.#blobsDir = join(this.#dataDir, DATA_ID, 'blobs');
  }

  envPromptVars() {
    return {};
  }

  /**
   * 本轮结束（assistant 自然结束 / LLM 失败 / 轮数上限）时收尾。
   *
   * 桌宠可能根本没回消息，这时「正在输入」必须撤掉，否则微信会一直显示输入中。
   */
  onTurnEnded() {
    void this.#driver?.stopAllTyping?.();
  }

  tools() {
    return CLAWBOT_TOOL_DECLS.map((decl) => ({
      ...decl,
      handler: (args) => this.#runTool(decl.name, args ?? {}),
    }));
  }

  async #runTool(name, args) {
    try {
      switch (name) {
        case 'clawbridge_send': return await this.#toolSend(args);
        case 'clawbridge_status': return this.#toolStatus();
        case 'clawbridge_events': return this.#toolEvents(args);
        default: return { text: `[clawbridge] unknown tool: ${name}`, failed: true };
      }
    } catch (err) {
      this.#host?.log?.error?.('clawbridge: 工具调用失败', { tool: name, error: msgOf(err) });
      return { text: `[clawbridge] ${msgOf(err)}`, failed: true };
    }
  }

  async #toolSend(args) {
    const script = String(args?.text ?? '').trim();
    const imageRefs = (Array.isArray(args?.images) ? args.images : [])
      .map((ref) => String(ref ?? '').trim())
      .filter(Boolean)
      .slice(0, this.#maxImages());
    const fileRefs = (Array.isArray(args?.files) ? args.files : [])
      .map((ref) => String(ref ?? '').trim())
      .filter(Boolean)
      .slice(0, this.#maxFiles());
    if (!script && imageRefs.length === 0 && fileRefs.length === 0) {
      return { text: failedReceipt('内容为空'), failed: true };
    }
    // 总开关关着时，files 参数直接拒（默认配置就是关）
    if (fileRefs.length > 0 && !this.#fileTransferOn()) {
      return { text: failedReceipt('文件收发未开启'), failed: true };
    }

    const { segments, truncated } = splitScript(script, {
      maxSegments: this.#maxSegments(),
      resolveMarker: this.#markerResolver(),
      isKnownMarker: isKnownWord,
    });
    if (segments.length === 0 && imageRefs.length === 0 && fileRefs.length === 0) {
      return { text: failedReceipt('内容为空'), failed: true };
    }

    // 单条超长不报错，自动按段落/句子切成多条（微信上限 4000）。
    // 注意：只切「自己太长的那一段」，不动 `【…】` 明确要求的语义分段。
    const expanded = [];
    for (const segment of segments) {
      if (countChars(segment) <= MAX_TEXT_CHARS) expanded.push(segment);
      else expanded.push(...splitLongText(segment, MAX_TEXT_CHARS));
    }
    const capped = limitSegments(expanded, { maxSegments: this.#maxSegments() });
    const outSegments = capped.segments;
    if (capped.dropped > 0) {
      this.#host?.log?.warn?.('clawbridge: 回复超过条数上限，尾部已截断', { dropped: capped.dropped });
    }

    const driver = this.#driver;
    if (!driver || !this.#auth?.token) return { text: failedReceipt('未连接'), failed: true };

    // 收件人钉死在绑定记录里，绝不跟随入站消息（防换号/异物消息串台）
    const to = String(this.#auth?.userId ?? '').trim();
    if (!to) {
      // 老绑定可能没存 userId：提示很明确，别让人以为是没扫码
      return { text: failedReceipt('还不知道微信是哪一位，等对方先发一条消息'), failed: true };
    }

    const contextToken = await this.#store.getContextToken(to);
    if (!contextToken) return { text: failedReceipt('上下文已过期'), failed: true };

    // 真要发东西了，先撤掉「正在输入」
    try { await driver.stopTyping?.(to); } catch { /* 无所谓 */ }

    const total = outSegments.length + imageRefs.length + fileRefs.length;
    let chars = 0;
    let sent = 0;
    let textSent = 0;
    let imageSent = 0;
    let fileSent = 0;

    for (const segment of outSegments) {
      try {
        await driver.sendText({ to, text: segment, contextToken });
      } catch (err) {
        this.#host?.log?.warn?.('clawbridge: 发送失败', {
          to: shortId(to),
          index: sent + 1,
          total,
          error: msgOf(err),
          ret: err?.ret,
          status: err?.status,
        });
        const where = total > 1 ? `第${sent + 1}条 ` : '';
        return { text: failedReceipt(`${where}${describeSendError(err)}`), failed: true };
      }
      sent += 1;
      textSent += 1;
      chars += countChars(segment);
      if (sent < total) await sleep(this.#segmentDelayMs());
    }

    for (const ref of imageRefs) {
      let bytes;
      try {
        bytes = await this.#loadImageBytes(ref);
      } catch (err) {
        const where = total > 1 ? `第${sent + 1}条 ` : '';
        return { text: failedReceipt(`${where}${imageErrorText(err)}`), failed: true };
      }
      try {
        await driver.sendImage({ to, bytes, contextToken, midSizeMode: this.#cfg?.midSizeMode });
      } catch (err) {
        this.#host?.log?.warn?.('clawbridge: 发图失败', {
          to: shortId(to),
          index: sent + 1,
          total,
          bytes: bytes.length,
          stage: err?.stage,
          error: msgOf(err),
          ret: err?.ret,
          status: err?.status,
        });
        await this.#noteImageFailure({
          ref,
          bytes: bytes.length,
          midSizeMode: this.#cfg?.midSizeMode ?? 'cipher',
          stage: err?.stage,
          ret: err?.ret,
          status: err?.status,
          detail: err?.detail,
          message: msgOf(err),
          response: err?.response,
        });
        const where = total > 1 ? `第${sent + 1}条 ` : '';
        return { text: failedReceipt(`${where}${describeSendError(err)}`), failed: true };
      }
      sent += 1;
      imageSent += 1;
      if (sent < total) await sleep(this.#segmentDelayMs());
    }

    for (const ref of fileRefs) {
      let loaded;
      try {
        loaded = await this.#loadFileBytes(ref);
      } catch (err) {
        const where = total > 1 ? `第${sent + 1}条 ` : '';
        return { text: failedReceipt(`${where}${fileErrorText(err)}`), failed: true };
      }
      try {
        await driver.sendFile({ to, bytes: loaded.bytes, fileName: loaded.name, contextToken });
      } catch (err) {
        this.#host?.log?.warn?.('clawbridge: 发文件失败', {
          to: shortId(to),
          index: sent + 1,
          total,
          bytes: loaded.bytes.length,
          name: loaded.name,
          stage: err?.stage,
          error: msgOf(err),
          ret: err?.ret,
          status: err?.status,
        });
        const where = total > 1 ? `第${sent + 1}条 ` : '';
        return { text: failedReceipt(`${where}${describeSendError(err)}`), failed: true };
      }
      sent += 1;
      fileSent += 1;
      if (sent < total) await sleep(this.#segmentDelayMs());
    }

    const detail = [
      textSent ? `${textSent}文` : '',
      imageSent ? `${imageSent}图` : '',
      fileSent ? `${fileSent}文件` : '',
    ].filter(Boolean).join('+');

    // 消息本体带关键数字：INFO 级日志不展开 detail 对象，只有写进字符串才看得见
    this.#host?.log?.info?.(`clawbridge: 已发送微信消息 ${sent}条(${detail || '—'}) ${chars}字`, {
      to: shortId(to),
      messages: sent,
      text: textSent,
      images: imageSent,
      files: fileSent,
      chars,
    });
    const receipt = sentReceipt({ chars, messages: sent, detail, timezone: this.#timezone });
    return { text: truncated ? `${receipt}（超上限已合并）` : receipt };
  }

  /** 单次最多几张图（默认 2）。 */
  #maxImages() {
    const value = Number(this.#cfg?.maxImages);
    if (!Number.isFinite(value) || value < 0) return 2;
    return Math.min(Math.floor(value), 4);
  }

  /** 收发文件总开关（默认关闭）。 */
  #fileTransferOn() {
    return this.#cfg?.fileTransfer === true;
  }

  /** 单次最多几个文件（默认 2，上限 4）。 */
  #maxFiles() {
    const value = Number(this.#cfg?.maxFiles);
    if (!Number.isFinite(value) || value < 0) return 2;
    return Math.min(Math.floor(value), 4);
  }

  /**
   * 允许读取图片的目录。
   *
   * 只放两棵子树，**不放 companion 根**——根下还有 `.env`、`config.json`、
   * `session-main.jsonl`（对话记录），不能让她发出去：
   * - `<dataDir>/clawbot`：桥下载的微信原图；
   * - `<companion>/workspace`：桌宠自己的工作区（她把图收藏在这里）。
   * 再往外一律拒绝；确有需要可以用 `imageRoots` 自行追加。
   */
  #imageRoots() {
    const roots = [
      join(this.#dataDir, DATA_ID),
      join(dirname(this.#dataDir), 'workspace'),
    ];
    const extra = this.#cfg?.imageRoots;
    if (Array.isArray(extra)) {
      for (const item of extra) {
        if (typeof item === 'string' && item.trim()) roots.push(item.trim());
      }
    }
    return roots.filter(Boolean).map((root) => resolve(String(root)));
  }

  /**
   * 允许发文件的目录：**只有桌宠自己的工作区**。
   *
   * 比图片更严：图片还能发 `clawbot/blobs`（把收到的图转发回去），
   * 文件不行——收来的是对方的东西，要再发就先自己复制进工作区。
   * `imageRoots` 之类的追加目录对文件**不生效**。
   */
  #fileRoots() {
    return [resolve(join(dirname(this.#dataDir), 'workspace'))];
  }

  /**
   * 把文件引用变成字节。
   *
   * 只认工作区里的绝对路径；句柄（`log:` / `mem:` / `sticker:`）、数据目录、
   * 机器上任意路径一律拒绝。
   *
   * 额外做一次 realpath 对照：工作区里放一个指向外面的软链，
   * 也不能把外面的文件发出去。
   */
  async #loadFileBytes(ref) {
    const value = String(ref ?? '').trim();
    if (!value) throw Object.assign(new Error('空引用'), { code: 'empty' });
    if (/^(?:log|mem|blob|sticker):/i.test(value)) {
      throw Object.assign(new Error('文件不支持句柄'), { code: 'denied' });
    }

    const abs = resolve(value);
    if (!await isInsideAnyResolved(abs, this.#fileRoots())) {
      throw Object.assign(new Error('路径不在允许范围'), { code: 'denied' });
    }

    const info = await stat(abs);
    if (!info.isFile()) throw Object.assign(new Error('不是文件'), { code: 'not-file' });
    if (info.size === 0) throw Object.assign(new Error('空文件'), { code: 'empty-file' });
    if (info.size > this.#maxFileBytes()) throw Object.assign(new Error('过大'), { code: 'too-large' });
    return { bytes: await readFile(abs), name: basename(abs) };
  }

  /**
   * 把图片引用变成字节。
   *
   * 支持三种：`log:` / `mem:` / `blob:` 句柄（走 host.blob），`sticker:名字`（素材目录），
   * 以及本地绝对路径（**只允许数据目录与工作区**，且按真实路径再校验一次，
   * 防止被诱导发送机器上的任意文件）。
   */
  async #loadImageBytes(ref) {
    const value = String(ref ?? '').trim();
    if (!value) throw Object.assign(new Error('空引用'), { code: 'empty' });

    // 图片表情包：`sticker:名字` → 在素材目录里找图
    const stickerName = stickerNameOf(value);
    if (stickerName) {
      const found = await findSticker(stickerName, this.#stickerRoots());
      if (!found) {
        throw Object.assign(new Error('表情不在素材表'), { code: 'sticker-missing', name: stickerName });
      }
      // 二次校验：表情名是模型给的，解析出来的路径必须仍在素材目录里
      if (!await isInsideAnyResolved(found.path, this.#stickerRoots())) {
        throw Object.assign(new Error('表情路径越界'), { code: 'denied' });
      }
      const info = await stat(found.path);
      if (info.size > this.#maxMediaBytes()) throw Object.assign(new Error('过大'), { code: 'too-large' });
      return readFile(found.path);
    }

    if (/^(?:log|mem|blob):/i.test(value)) {
      const blob = this.#host?.blob?.(value);
      if (!blob?.bytes) throw Object.assign(new Error('句柄无效'), { code: 'missing-blob' });
      const bytes = Buffer.from(blob.bytes);
      if (bytes.length > this.#maxMediaBytes()) throw Object.assign(new Error('过大'), { code: 'too-large' });
      return bytes;
    }

    const abs = resolve(value);
    if (!await isInsideAnyResolved(abs, this.#imageRoots())) {
      throw Object.assign(new Error('路径不在允许范围'), { code: 'denied' });
    }

    const info = await stat(abs);
    if (!info.isFile()) throw Object.assign(new Error('不是文件'), { code: 'not-file' });
    if (info.size > this.#maxMediaBytes()) throw Object.assign(new Error('过大'), { code: 'too-large' });
    return readFile(abs);
  }

  /**
   * 记下最近一次发图失败（`<dataDir>/clawbot/last-image-error.json`）。
   *
   * 回执只放一句短原因，真正有用的是接口返回的 errmsg，落盘便于排查。
   */
  async #noteImageFailure(info) {
    try {
      await writeFile(
        join(this.#dataDir, DATA_ID, 'last-image-error.json'),
        JSON.stringify({ at: new Date().toISOString(), ...info }, null, 2),
        { mode: 0o600 },
      );
    } catch {
      /* 诊断写入失败不影响主流程 */
    }
  }

  /**
   * 图片表情包的搜索目录：桥的数据目录 + 桌宠工作区 + 配置追加。
   * 素材由使用者自己放（`tools/make-stickers.py` 可在本机生成一套自用）。
   */
  #stickerRoots() {
    const roots = [
      join(this.#dataDir, DATA_ID, 'stickers'),
      join(dirname(this.#dataDir), 'workspace', 'stickers'),
    ];
    const extra = this.#cfg?.stickerRoots;
    if (Array.isArray(extra)) {
      for (const item of extra) {
        if (typeof item === 'string' && item.trim()) roots.push(item.trim());
      }
    }
    return roots.map((root) => resolve(String(root)));
  }

  /** 单次最多发几条（默认 4，上限 10）。 */
  #maxSegments() {
    const value = Number(this.#cfg?.maxSegments);
    if (!Number.isFinite(value) || value <= 0) return 4;
    return Math.min(Math.max(1, Math.floor(value)), 10);
  }

  /** 消息之间的间隔（默认 600ms，±30% 抖动）。 */
  #segmentDelayMs() {
    const value = Number(this.#cfg?.segmentDelayMs);
    const base = Number.isFinite(value) && value >= 0 ? value : 600;
    if (base === 0) return 0;
    return Math.max(0, Math.round(base * (0.7 + Math.random() * 0.6)));
  }

  /** 标记 → 前缀文字：表情换 emoji，动作/未知词返回空串。 */
  #markerResolver() {
    if (this.#cfg?.emojiReplace === false) return () => '';
    const overrides = this.#cfg?.emojiOverrides;
    return (word) => resolveEmoji(word, overrides);
  }

  #toolStatus() {
    const state = this.#publicState();
    return JSON.stringify({
      bound: state.bound,
      connected: state.connected,
      status: state.status,
      networkMode: state.networkMode,
      proxyConfigured: Boolean(String(this.#cfg?.proxyUrl ?? '').trim()),
      accountId: state.accountId,
      userId: state.userId,
      baseUrl: state.baseUrl,
      lastMessageAt: state.lastMessageAt,
      lastError: state.lastError,
      contextTokens: state.contextTokens,
      startedAt: state.startedAt,
    }, null, 2);
  }

  #toolEvents(args) {
    const host = this.#host;
    if (!host?.store) throw new Error('World is not running.');
    const kind = typeof args?.kind === 'string' ? args.kind.trim() : '';
    const since = parseIso(args?.since);
    const until = parseIso(args?.until);
    if (since === false) throw new Error(`since "${args.since}" is not an ISO 8601 time.`);
    if (until === false) throw new Error(`until "${args.until}" is not an ISO 8601 time.`);
    const limit = Math.max(1, Math.min(100, Number(args?.limit) || DEFAULT_EVENT_LIMIT));
    const match = kindMatcher(kind);
    const query = { source: ID, limit: 2000 };
    if (since) query.fromTs = since;
    if (until) query.toTs = until;
    const events = host.store.range(query)
      .filter((event) => event.type === EVENT_MESSAGE)
      .filter((event) => match(event.meta?.kind))
      .slice(-limit)
      .map((event) => ({
        ts: event.ts,
        type: event.type,
        kind: event.meta?.kind ?? '',
        text: event.text,
        ...(args?.raw === true ? { raw: event.meta?.raw } : {}),
      }));
    return JSON.stringify({ count: events.length, events }, null, 2);
  }

  #publicState() {
    const auth = this.#auth;
    const login = this.#login;
    const bound = Boolean(auth?.token);
    const connected = this.#driver?.connected === true;
    const status = login?.active
      ? 'binding'
      : bound
        ? (connected ? 'connected' : 'connecting')
        : (login?.error || this.#lastError ? 'error' : 'unbound');
    return {
      bound,
      connected,
      running: this.#driver?.running === true,
      started: this.#started,
      status,
      networkMode: this.#networkMode(),
      accountId: auth?.accountId ?? '',
      userId: auth?.userId ?? '',
      baseUrl: auth?.baseUrl ?? '',
      lastMessageAt: this.#lastMessageAt,
      lastError: this.#lastError,
      contextTokens: this.#contextCount,
      startedAt: this.#startedAt,
      qrDataUrl: login?.qrDataUrl ?? '',
      qrUrl: login?.qrUrl ?? '',
      loginStatus: login?.status ?? '',
      loginError: login?.error ?? '',
      loginErrorCode: login?.errorCode ?? '',
    };
  }

  #invokePanel(panel, method, args) {
    if (panel === 'media') {
      if (method === 'list') return listRecentMedia(join(this.#dataDir, DATA_ID, 'blobs'));
      throw new Error(`unknown method: ${panel}.${method}`);
    }
    if (panel !== 'binding') throw new Error(`unknown panel: ${panel}`);
    if (method === 'state') return this.#publicState();
    if (method === 'start') return this.#startBinding();
    if (method === 'verify') return this.#submitVerify(args?.[0]);
    if (method === 'cancel') return this.#cancelBinding();
    if (method === 'reconnect') return this.#reconnect();
    throw new Error(`unknown method: ${panel}.${method}`);
  }

  async #reconnect() {
    if (!this.#auth?.token) throw new Error('未绑定微信；先扫码。');
    const driver = this.#driver;
    this.#driver = null;
    this.#lastError = '';
    if (driver) await driver.stop();
    await this.#startDriver();
    this.#host?.log?.info?.('clawbot: 手动重连');
    return this.#publicState();
  }

  async #startBinding() {
    if (this.#auth?.token) return this.#publicState();
    if (this.#login?.active) return this.#publicState();
    if (!this.#started) throw new Error('World is not started; enable it first.');

    this.#login = {
      active: true,
      status: 'requesting',
      qrcode: '',
      qrUrl: '',
      qrDataUrl: '',
      startedAt: Date.now(),
      verifyCode: '',
      error: '',
      errorCode: '',
      refreshCount: 0,
      baseUrl: this.#apiBaseUrl,
    };
    this.#loginAbort = new AbortController();

    this.#loginLoop = this.#runLogin().catch((err) => {
      if (!this.#login?.active) return;
      this.#failLogin('poll_failed', `扫码轮询失败：${msgOf(err)}`);
      this.#host?.log?.warn?.('clawbot: 扫码轮询失败', { error: msgOf(err) });
    });
    return this.#publicState();
  }

  async #runLogin() {
    try {
      await this.#newQr();
    } catch (err) {
      if (!this.#login?.active) return;
      this.#host?.log?.warn?.('clawbot: 生成二维码失败', { error: msgOf(err) });
      this.#failLogin('qr_failed', `生成二维码失败（${this.#networkMode()}）：${msgOf(err)}`);
      return;
    }
    if (!this.#login?.active) return;
    await this.#pollLogin();
  }

  async #newQr() {
    const login = this.#login;
    if (!login?.active) return;
    login.status = 'requesting';

    let qr = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        qr = await fetchQrCode({
          baseUrl: login.baseUrl,
          fetchImpl: this.#fetchImpl,
          dispatcher: this.#dispatcher,
        });
        break;
      } catch (err) {
        lastError = err;
        if (!login.active) return;
        if (err?.status >= 400 && err?.status < 500) break;
        if (attempt < 3) await sleep(attempt * 1000);
      }
    }
    if (!qr) throw lastError ?? new Error('二维码请求失败');
    login.status = 'rendering';

    const qrDataUrl = await QRCode.toDataURL(qr.qrUrl, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
    });
    if (!login.active) return;
    login.qrcode = qr.qrcode;
    login.qrUrl = qr.qrUrl;
    login.qrDataUrl = qrDataUrl;
    login.status = 'wait';
    login.error = '';
    login.errorCode = '';
    login.verifyCode = '';
    login.startedAt = Date.now();
  }

  async #pollLogin() {
    const login = this.#login;
    while (login?.active) {
      if (login.status === 'need_verifycode' && !login.verifyCode) {
        await sleep(1000);
        continue;
      }

      let response;
      try {
        response = await pollQrStatus({
          baseUrl: login.baseUrl,
          qrcode: login.qrcode,
          verifyCode: login.verifyCode,
          fetchImpl: this.#fetchImpl,
          dispatcher: this.#dispatcher,
          signal: this.#loginAbort?.signal,
        });
        login.error = '';
        login.errorCode = '';
      } catch (err) {
        if (!login.active) return;
        const detail = msgOf(err);
        login.error = `扫码状态暂时连不上：${detail}`;
        login.errorCode = 'poll_retry';
        this.#host?.log?.warn?.('clawbot: 扫码状态轮询失败，继续重试', {
          error: detail,
          baseUrl: login.baseUrl,
          elapsedMs: Date.now() - login.startedAt,
        });
        if (Date.now() - login.startedAt > 5 * 60_000) {
          this.#failLogin('poll_failed', `扫码等待超时：${detail}`);
          return;
        }
        await sleep(1500);
        continue;
      }
      if (!login.active) return;

      const status = String(response?.status ?? 'wait');
      login.status = status;
      if (status === 'scaned') login.verifyCode = '';

      switch (status) {
        case 'wait':
        case 'scaned':
        case 'need_verifycode':
          break;
        case 'scaned_but_redirect': {
          const host = String(response?.redirect_host ?? '').trim();
          if (host) login.baseUrl = `https://${host}`;
          break;
        }
        case 'expired': {
          login.refreshCount += 1;
          if (login.refreshCount > 3) {
            this.#failLogin('expired', '二维码多次失效，请重新生成。');
            return;
          }
          await this.#newQr();
          break;
        }
        case 'verify_code_blocked':
          this.#failLogin('verify_blocked', '验证码多次错误，请稍后再试。');
          return;
        case 'binded_redirect':
          if (response?.bot_token && response?.ilink_bot_id) {
            await this.#finishLogin(response);
            return;
          }
          if (this.#auth?.token) {
            login.active = false;
            login.status = 'connected';
            login.qrDataUrl = '';
            login.qrUrl = '';
          } else {
            this.#failLogin(
              'already_bound',
              '这个微信已经绑定过另一个客户端；请先在微信里解除绑定，或继续使用原客户端。',
            );
          }
          return;
        case 'confirmed':
          await this.#finishLogin(response);
          return;
        default:
          break;
      }

      await sleep(1000);
    }
  }

  #failLogin(code, message) {
    const login = this.#login;
    if (!login) return;
    login.active = false;
    login.status = 'error';
    login.errorCode = code;
    login.error = message;
    login.qrDataUrl = '';
    login.qrUrl = '';
    this.#lastError = message;
    this.#loginAbort?.abort();
  }

  async #finishLogin(response) {
    const token = String(response?.bot_token ?? '').trim();
    const accountId = String(response?.ilink_bot_id ?? '').trim();
    const userId = String(response?.ilink_user_id ?? '').trim();
    if (!token || !accountId) {
      this.#failLogin('confirmed_incomplete', '微信确认了登录，但没有返回 bot_token 或 ilink_bot_id。');
      return;
    }
    const baseUrl = String(response?.baseurl ?? '').trim()
      || this.#login?.baseUrl
      || this.#apiBaseUrl;
    const auth = {
      token,
      baseUrl,
      accountId,
      userId,
      savedAt: new Date().toISOString(),
    };

    await this.#store.clearContextTokens();
    await this.#store.saveSyncBuf('');
    await this.#store.saveAuth(auth);

    this.#auth = auth;
    this.#lastError = '';
    this.#expired = false;
    this.#contextCount = 0;
    this.#login.active = false;
    this.#login.status = 'connected';
    this.#login.error = '';
    this.#login.errorCode = '';
    this.#login.qrDataUrl = '';
    this.#login.qrUrl = '';
    this.#login.verifyCode = '';
    await this.#startDriver();
    this.#host?.log?.info?.('clawbot: 微信绑定成功', { accountId, userId: shortId(userId) });
  }

  #submitVerify(code) {
    if (!this.#login?.active) throw new Error('当前没有进行中的扫码。');
    const value = String(code ?? '').trim();
    if (!/^\d{1,8}$/.test(value)) throw new Error('请输入手机微信显示的数字验证码。');
    this.#login.verifyCode = value;
    return this.#publicState();
  }

  #cancelBinding() {
    const login = this.#login;
    if (login?.active) {
      login.active = false;
      login.status = 'unbound';
      login.error = '';
      login.errorCode = '';
      login.qrDataUrl = '';
      login.qrUrl = '';
      this.#loginAbort?.abort();
    }
    return this.#publicState();
  }

  webUi(language = 'zh') {
    const t = text(language);
    const state = this.#publicState();
    const who = shortId(state.userId || state.accountId);
    return {
      label: t.label,
      lamps: [{
        label: t.lamp,
        state: state.connected ? 'online' : (state.bound ? 'loading' : 'offline'),
        hint: state.connected
          ? t.hintReady(who)
          : (state.bound ? t.connecting : (state.error || t.hintUnbound)),
      }],
      badges: [
        {
          label: t.badgeAccount,
          value: state.bound ? (who || '—') : '—',
          tone: state.bound ? 'on' : 'off',
        },
        {
          label: t.badgeLast,
          value: state.lastMessageAt ? state.lastMessageAt.slice(11, 19) : '—',
          tone: state.lastMessageAt ? 'on' : 'off',
        },
        {
          label: t.badgeState,
          value: t[state.status] ?? state.status,
          tone: state.connected ? 'on' : 'off',
        },
      ],
      panels: [{
        id: 'binding',
        title: t.panelTitle,
        description: t.panelDesc,
        getMethods: ['state'],
      }, {
        id: 'media',
        title: t.panelMediaTitle,
        description: t.panelMediaDesc,
        getMethods: ['list'],
      }],
      invoke: (panel, method, args) => this.#invokePanel(panel, method, args ?? []),
      config: [configGroup(language)],
      promptDocs: [{
        key: `worlds.${ID}.env`,
        title: t.promptTitle,
        path: ENV_PROMPT,
        role: 'envPrompt',
      }],
    };
  }

  async start(host) {
    if (this.#started) return;
    this.#host = host;
    this.#startedAt = nowIso();

    // 表情包素材目录：建好让用户直接往里丢图
    try {
      await mkdir(this.#stickerRoots()[0], { recursive: true });
    } catch {
      /* 建不出来也不影响启动 */
    }

    // 顺手清理过期图片与媒体凭证（失败只记日志）
    void this.#cleanupOldMedia();

    const mode = this.#networkMode();
    if (mode === 'inherit') {
      this.#dispatcher = null;
      if (!this.#fetchOverride) this.#fetchImpl = globalThis.fetch;
    } else {
      if (!this.#fetchOverride) this.#fetchImpl = undiciFetch;
      try {
        this.#dispatcher = createDispatcher({
          mode,
          proxyUrl: this.#cfg?.proxyUrl,
          forceIpv4: this.#cfg?.forceIpv4 === true,
        });
      } catch (err) {
        this.#dispatcher = null;
        this.#lastError = msgOf(err);
        if (!this.#fetchOverride) this.#fetchImpl = globalThis.fetch;
        host?.log?.error?.('clawbot: 网络出口配置无效，改用跟随 Coopanion', {
          error: this.#lastError,
        });
      }
    }
    this.#auth = await this.#store.loadAuth();
    if (this.#auth && !this.#auth.baseUrl) this.#auth.baseUrl = this.#apiBaseUrl;
    try {
      this.#contextCount = Object.keys(await this.#store.loadContextTokens()).length;
    } catch {
      this.#contextCount = 0;
    }
    this.#started = true;
    if (this.#auth?.token) {
      await this.#startDriver();
    } else {
      host?.log?.info?.('clawbot: 尚未绑定微信，等待扫码');
    }
  }

  async #startDriver() {
    const previous = this.#driver;
    this.#driver = null;
    if (previous) {
      // 必须等旧连接停稳，否则两个驱动各带游标，会抢消息、重复回复
      try {
        await previous.stop();
      } catch (err) {
        this.#host?.log?.warn?.('clawbot: 旧连接关闭失败', { error: msgOf(err) });
      }
    }
    this.#expired = false;

    let driver;
    driver = new ILinkDriver({
      auth: this.#auth,
      store: this.#store,
      log: this.#host?.log,
      fetchImpl: this.#fetchImpl,
      dispatcher: this.#dispatcher,
      onMessage: (message) => this.#handleInbound(driver, message),
      onStatus: (status) => this.#handleDriverStatus(driver, status),
    });
    this.#driver = driver;
    driver.start();
  }

  #handleDriverStatus(driver, status) {
    if (driver !== this.#driver) return;
    if (status.connected) {
      this.#lastError = '';
      return;
    }
    if (status.expired) {
      this.#handleExpired(driver);
      return;
    }
    if (status.paused) {
      this.#lastError = '微信会话暂停，约一小时后自动重试（不用重新扫码）';
      return;
    }
    this.#lastError = status.error || 'disconnected';
  }

  #handleExpired(driver) {
    if (driver !== this.#driver || this.#expired) return;
    this.#expired = true;
    this.#lastError = '微信会话已过期，请重新扫码绑定。';
    this.#driver = null;
    this.#auth = null;
    this.#contextCount = 0;
    // 换号/过期后必须清掉上一任的痕迹，否则新号绑定后第一条回复会发给旧号
    this.#lastUserId = '';
    driver.stop().catch(() => {});
    this.#store.clearSession().catch((err) => {
      this.#host?.log?.warn?.('clawbot: 清理过期会话失败', { error: msgOf(err) });
    });
  }

  async #handleInbound(driver, message) {
    if (driver !== this.#driver) return;
    if (Number(message?.message_type) === 2) return;
    const from = String(message?.from_user_id ?? '').trim();
    if (!from) return;
    if (this.#auth?.accountId && from === this.#auth.accountId) return;

    // 只接受绑定本人发来的消息：不是本人的，丢弃且不进上下文、不存 token。
    // 这样即使外部混进别人的消息，也不可能把回复发到陌生人那里。
    const owner = String(this.#auth?.userId ?? '').trim();
    if (owner) {
      if (from !== owner) {
        this.#host?.log?.warn?.('clawbridge: 非绑定本人发来的消息，已忽略', { from: shortId(from) });
        return;
      }
    } else if (this.#auth) {
      // 兼容老绑定：`ilink_user_id` 是可选字段，早期绑定记录里可能没有 userId。
      // 这种情况下认领「第一条消息的发送者」为本人并写回，之后严格比对（只认领一次）。
      this.#auth.userId = from;
      try {
        await this.#store.saveAuth(this.#auth);
        this.#host?.log?.info?.('clawbridge: 绑定记录缺 userId，已认领首条消息的发送者', { from: shortId(from) });
      } catch (err) {
        this.#host?.log?.warn?.('clawbridge: 认领本人失败', { error: msgOf(err) });
      }
    }

    const contextToken = String(message?.context_token ?? '').trim();
    if (contextToken) {
      try {
        this.#contextCount = await this.#store.saveContextToken(from, contextToken);
      } catch (err) {
        this.#host?.log?.warn?.('clawbot: context_token 没存下来', { error: msgOf(err) });
      }
    }

    const attachments = await this.#captureMedia(message, from);

    this.#lastUserId = from;
    this.#lastMessageAt = new Date(messageTime(message)).toISOString();
    const host = this.#host;
    if (!host?.pushEvent) return;
    const blobs = await this.#blobsFor(host, attachments);
    await host.pushEvent({
      type: EVENT_MESSAGE,
      ts: this.#lastMessageAt,
      source: ID,
      text: renderMessage(message, this.#timezone, attachments),
      senderKey: from,
      ...(blobs.length ? { blobs } : {}),
      meta: {
        kind: 'message/private',
        raw: slimRaw(message),
        conv: { kind: 'private', id: from },
      },
    }, { deliver: true, trigger: 'debounce' });

    // 事件交给桌宠后，微信侧显示「对方正在输入」，直到我们把回复发出去
    if (this.#cfg?.typingIndicator !== false) {
      void this.#driver?.startTyping?.(from, contextToken);
    }
  }

  /**
   * 把已落盘的图片整理成事件附件（`BlobInput`）。
   *
   * 只在 `mediaAttach` 打开、且当前模型接受该 MIME 时才附加。
   */
  /** 清理过期图片与媒体凭证（默认保留 7 天，配置 0 关闭）。 */
  async #cleanupOldMedia() {
    const days = Number(this.#cfg?.mediaRetentionDays);
    if (!Number.isFinite(days) || days <= 0) return;
    const dirs = [
      join(this.#dataDir, DATA_ID, 'blobs'),
      join(this.#dataDir, DATA_ID, 'media'),
    ];
    let removed = 0;
    let bytes = 0;
    for (const dir of dirs) {
      try {
        const result = await cleanOldFiles(dir, { days });
        if (result.removed > 0) {
          removed += result.removed;
          bytes += result.bytes;
          const dirName = dir.split(/[\\/]/).pop();
          this.#host?.log?.info?.(
            `clawbridge: 清理 ${dirName} 删除 ${result.removed} 个（保留 ${result.kept}，${Math.round(result.bytes / 1024)} KB）`,
            { dir: dirName, ...result },
          );
        }
      } catch (err) {
        this.#host?.log?.warn?.('clawbridge: 清理失败', { error: msgOf(err) });
      }
    }
    if (removed > 0) {
      this.#host?.log?.info?.(
        `clawbridge: 清理完成 共删 ${removed} 个 / ${Math.round(bytes / 1024)} KB（保留 ${days} 天）`,
        { removed, kb: Math.round(bytes / 1024), days },
      );
    }
  }

  async #blobsFor(host, attachments) {
    const blobs = imageBlobsFor(attachments, {
      enabled: this.#cfg?.mediaAttach === true,
      modelFacts: host?.modelFacts ?? null,
      log: host?.log,
    });
    if (!blobs.length) return blobs;

    const maxEdge = this.#mediaMaxEdge();
    if (!maxEdge) return blobs;

    // 只缩「送模型的那一份」；落盘的原图不动
    const out = [];
    for (const blob of blobs) {
      const bytes = blob?.bytes;
      if (!bytes || !bytes.length) {
        out.push(blob);
        continue;
      }
      let shrunk;
      try {
        shrunk = await downscaleForModel(bytes, {
          maxEdge,
          quality: this.#mediaQuality(),
          mime: blob.mime,
        });
      } catch {
        out.push(blob);
        continue;
      }
      if (shrunk.changed) {
        this.#host?.log?.info?.('clawbridge: 图片已降采样', {
          from: shrunk.from,
          to: { width: shrunk.width, height: shrunk.height },
          inputBytes: shrunk.inputBytes,
          outputBytes: shrunk.outputBytes,
        });
        out.push({ ...blob, bytes: shrunk.bytes, mime: shrunk.mime ?? blob.mime });
      } else {
        out.push(blob);
      }
    }
    return out;
  }

  /** 送模型的图片长边上限（默认 768；<=0 表示关闭降采样）。 */
  #mediaMaxEdge() {
    const value = Number(this.#cfg?.mediaMaxEdge);
    if (!Number.isFinite(value)) return DEFAULT_MAX_EDGE;
    return value <= 0 ? 0 : value;
  }

  /** JPEG 质量（默认 82）。 */
  #mediaQuality() {
    const value = Number(this.#cfg?.mediaQuality);
    return Number.isFinite(value) && value > 0 ? Math.min(100, value) : DEFAULT_QUALITY;
  }

  /**
   * 处理入站媒体：凭证落私有存储，图片顺便下载解密到 blobs/。
   *
   * 事件正文与 meta 只保留 msgId；凭证不出去。
   * 任何失败都只记日志，不阻塞消息投递。
   *
   * @returns {Promise<Map<number, { path: string, mime: string }>>}
   */
  #captureMedia(message, from) {
    return captureMediaItems({
      message,
      from,
      store: this.#mediaRefs,
      blobsDir: this.#blobsDir,
      fetchImpl: this.#fetchImpl,
      maxBytes: this.#maxMediaBytes(),
      log: this.#host?.log,
      download: this.#cfg?.mediaDownload !== false,
      fileTransfer: this.#fileTransferOn(),
      maxFileBytes: this.#maxFileBytes(),
    });
  }

  #maxMediaBytes() {
    const configured = Number(this.#cfg?.maxMediaBytes);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
  }

  /** 文件/视频上限（字节）：配置里填的是 MB（`maxFileMb`），这里换算。 */
  #maxFileBytes() {
    const mb = Number(this.#cfg?.maxFileMb);
    const value = Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_FILE_MB;
    return Math.floor(value * 1024 * 1024);
  }

  async stop() {
    this.#started = false;
    const login = this.#login;
    if (login?.active) login.active = false;
    this.#loginAbort?.abort();
    const loginLoop = this.#loginLoop;
    this.#loginLoop = null;
    if (loginLoop) await loginLoop.catch(() => {});
    const driver = this.#driver;
    this.#driver = null;
    if (driver) await driver.stop();
    const dispatcher = this.#dispatcher;
    this.#dispatcher = null;
    if (dispatcher) await closeDispatcher(dispatcher);
    this.#host = null;
  }

  #networkMode() {
    const value = String(this.#cfg?.networkMode ?? 'inherit');
    return ['inherit', 'direct', 'proxy'].includes(value) ? value : 'inherit';
  }
}
