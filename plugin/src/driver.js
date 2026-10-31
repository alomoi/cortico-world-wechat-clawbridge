/**
 * iLink 长轮询驱动。
 *
 * 一条循环持续拉 getupdates；发送走独立的 sendmessage。
 * 回调只把消息交给 World，重连与 -14 会话过期在这里识别。
 */
import {
  getConfig,
  getUpdates,
  getUploadUrl,
  randomAesKeyHex,
  sendImage,
  sendText,
  sendTyping,
  uploadCiphertext,
  ILinkError,
  TYPING_STATUS,
} from './api.js';
import { prepareMediaUpload } from './media.js';
import { createSeenSet, messageKeyOf } from './seen.js';

const msgOf = (err) => (err instanceof Error ? err.message : String(err));

/** 「正在输入」的续发间隔（微信侧会过期，需要周期性重发）。 */
const TYPING_REFRESH_MS = 4000;
/**
 * 兜底上限：正常路径由「发送消息」或 `onTurnEnded()` 取消，
 * 这里是防止两者都没触发时一直显示输入中。
 */
const TYPING_MAX_MS = 60_000;

export class ILinkDriver {
  #auth;
  #store;
  #log;
  #fetchImpl;
  #dispatcher;
  #onMessage;
  #onStatus;
  #stopped = true;
  #loop = null;
  #abort = null;
  #wake = null;
  #pollTimeoutMs;
  /** user → typing ticket */
  #typingTickets = new Map();
  /** 入站消息去重（有上限的 FIFO） */
  #seen = createSeenSet(500);
  /** user → { timer, expire } */
  #typing = new Map();
  #reconnectBaseMs;
  #reconnectMaxMs;

  running = false;
  connected = false;

  constructor({
    auth,
    store,
    log = null,
    fetchImpl = globalThis.fetch,
    dispatcher = null,
    onMessage,
    onStatus,
    pollTimeoutMs = 35000,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30000,
  }) {
    this.#auth = auth;
    this.#store = store;
    this.#log = log;
    this.#fetchImpl = fetchImpl;
    this.#dispatcher = dispatcher;
    this.#onMessage = onMessage;
    this.#onStatus = onStatus;
    this.#pollTimeoutMs = pollTimeoutMs;
    this.#reconnectBaseMs = reconnectBaseMs;
    this.#reconnectMaxMs = reconnectMaxMs;
  }

  get identity() {
    return {
      accountId: this.#auth?.accountId ?? '',
      userId: this.#auth?.userId ?? '',
      baseUrl: this.#auth?.baseUrl ?? '',
    };
  }

  start() {
    if (this.running) return;
    this.#stopped = false;
    this.running = true;
    this.#loop = this.#run().finally(() => {
      this.running = false;
      this.connected = false;
    });
  }

  async stop() {
    this.#stopped = true;
    this.#clearTyping();
    this.#wake?.();
    this.#wake = null;
    this.#abort?.abort();
    const loop = this.#loop;
    this.#loop = null;
    if (loop) await loop.catch(() => {});
    this.running = false;
    this.connected = false;
  }

  async sendText({ to, text, contextToken }) {
    return sendText({
      baseUrl: this.#auth.baseUrl,
      token: this.#auth.token,
      to,
      text,
      contextToken,
      fetchImpl: this.#fetchImpl,
      dispatcher: this.#dispatcher,
    });
  }

  /**
   * 发一张图：加密 → 取上传地址 → 上传密文 → 发图片消息。
   *
   * `midSize` 先按密文长度传（官方注释口径）；若真机显示坏图，
   * 改用明文字节数，`midSizeMode: 'plain'`。
   */
  async sendImage({ to, bytes, contextToken, midSizeMode = 'cipher' }) {
    const prepared = prepareMediaUpload(bytes, { keyHex: randomAesKeyHex() });
    const filekey = randomAesKeyHex();

    const upload = await getUploadUrl({
      baseUrl: this.#auth.baseUrl,
      token: this.#auth.token,
      filekey,
      mediaType: 1,
      toUserId: to,
      rawSize: prepared.rawSize,
      rawMd5: prepared.rawMd5,
      fileSize: prepared.cipherSize,
      aesKeyHex: prepared.keyHex,
      noNeedThumb: true,
      fetchImpl: this.#fetchImpl,
      dispatcher: this.#dispatcher,
    });

    const url = upload.url || this.#uploadUrlFromParam(upload.param, filekey);
    let encryptQueryParam;
    try {
      encryptQueryParam = await uploadCiphertext({
        url,
        ciphertext: prepared.cipher,
        fetchImpl: this.#fetchImpl,
        dispatcher: this.#dispatcher,
      });
    } catch (err) {
      if (err && typeof err === 'object') {
        err.uploadUrl = String(url).split('?')[0];
        err.usedFallbackUrl = !upload.url;
        err.filekey = filekey;
        err.rawSize = prepared.rawSize;
        err.cipherSize = prepared.cipherSize;
      }
      throw err;
    }

    const midSize = midSizeMode === 'plain' ? prepared.rawSize : prepared.cipherSize;
    return sendImage({
      baseUrl: this.#auth.baseUrl,
      token: this.#auth.token,
      to,
      encryptQueryParam,
      aesKeyHex: prepared.keyHex,
      midSize,
      contextToken,
      fetchImpl: this.#fetchImpl,
      dispatcher: this.#dispatcher,
    });
  }

  /** 取（并缓存）typing ticket。 */
  async #typingTicket(to, contextToken) {
    const cached = this.#typingTickets.get(to);
    if (cached) return cached;
    const cfg = await getConfig({
      baseUrl: this.#auth.baseUrl,
      token: this.#auth.token,
      ilinkUserId: to,
      contextToken,
      fetchImpl: this.#fetchImpl,
      dispatcher: this.#dispatcher,
    });
    const ticket = String(cfg?.typing_ticket ?? '');
    if (ticket) this.#typingTickets.set(to, ticket);
    return ticket;
  }

  /** 开始显示「正在输入」：立刻发一次，之后每 4s 续发（微信侧会过期）。 */
  async startTyping(to, contextToken) {
    const user = String(to ?? '');
    if (!user || !this.running || !this.#auth?.token) return;
    if (this.#typing.has(user)) return;

    const state = { timer: null, expire: null, contextToken: String(contextToken ?? '') };
    this.#typing.set(user, state);
    const ping = async () => {
      try {
        const ticket = await this.#typingTicket(user, contextToken);
        await sendTyping({
          baseUrl: this.#auth.baseUrl,
          token: this.#auth.token,
          to: user,
          typingTicket: ticket,
          status: TYPING_STATUS.TYPING,
          fetchImpl: this.#fetchImpl,
          dispatcher: this.#dispatcher,
        });
      } catch (err) {
        this.#log?.debug?.('clawbridge: typing 发送失败', { error: msgOf(err) });
      }
    };
    await ping();
    state.timer = setInterval(ping, TYPING_REFRESH_MS);
    state.timer.unref?.();
    state.expire = setTimeout(() => { void this.stopTyping(user); }, TYPING_MAX_MS);
    state.expire.unref?.();
  }

  /** 取消「正在输入」。 */
  async stopTyping(to) {
    const user = String(to ?? '');
    const state = this.#typing.get(user);
    if (!state) {
      // 没在输入状态就不打扰接口
      return;
    }
    this.#typing.delete(user);
    if (state.timer) clearInterval(state.timer);
    if (state.expire) clearTimeout(state.expire);
    if (!this.#auth?.token) return;

    // 取消也要带 ticket；没有就现取一次
    let ticket = this.#typingTickets.get(user) ?? '';
    if (!ticket) {
      try {
        ticket = await this.#typingTicket(user, state.contextToken);
      } catch {
        ticket = '';
      }
    }
    try {
      await sendTyping({
        baseUrl: this.#auth.baseUrl,
        token: this.#auth.token,
        to: user,
        typingTicket: ticket,
        status: TYPING_STATUS.CANCEL,
        fetchImpl: this.#fetchImpl,
        dispatcher: this.#dispatcher,
      });
    } catch (err) {
      this.#log?.debug?.('clawbridge: 取消输入状态失败', { error: msgOf(err) });
    }
  }

  /** 取消所有用户的「正在输入」（本轮结束时调用）。 */
  async stopAllTyping() {
    const users = [...this.#typing.keys()];
    for (const user of users) {
      await this.stopTyping(user);
    }
  }

  /** 停掉所有 typing 定时器。 */
  #clearTyping() {
    for (const [, state] of this.#typing) {
      if (state.timer) clearInterval(state.timer);
      if (state.expire) clearTimeout(state.expire);
    }
    this.#typing.clear();
  }

  /** 响应只给了 upload_param 时，按官方 CDN 规则自己拼上传地址（必须带 filekey）。 */
  #uploadUrlFromParam(param, filekey) {
    const p = String(param ?? '').trim();
    if (!p) throw new ILinkError('上传地址与 upload_param 都为空');
    const fk = encodeURIComponent(String(filekey ?? ''));
    return `https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=${encodeURIComponent(p)}&filekey=${fk}`;
  }

  async #run() {
    let syncBuf = '';
    try {
      syncBuf = await this.#store.loadSyncBuf();
    } catch (err) {
      this.#log?.warn?.('ilink: 读不到同步游标，从空游标开始', { error: msgOf(err) });
    }

    let backoff = this.#reconnectBaseMs;
    while (!this.#stopped) {
      const controller = new AbortController();
      this.#abort = controller;
      try {
        const response = await getUpdates({
          baseUrl: this.#auth.baseUrl,
          token: this.#auth.token,
          syncBuf,
          fetchImpl: this.#fetchImpl,
          dispatcher: this.#dispatcher,
          timeoutMs: this.#pollTimeoutMs,
          signal: controller.signal,
        });
        if (this.#stopped) return;

        if (Number(response?.errcode) === -14) {
          this.connected = false;
          this.#emit({ connected: false, expired: true, error: 'session expired' });
          return;
        }
        if (response?.ret !== undefined && response.ret !== 0) {
          throw new ILinkError(
            `getupdates ret=${response.ret}${response.errmsg ? ` ${String(response.errmsg)}` : ''}`,
            { ret: response.ret, errcode: response.errcode },
          );
        }

        if (typeof response?.get_updates_buf === 'string') {
          syncBuf = response.get_updates_buf;
          try {
            await this.#store.saveSyncBuf(syncBuf);
          } catch (err) {
            this.#log?.warn?.('ilink: 同步游标没存下来', { error: msgOf(err) });
          }
        }
        const suggested = Number(response?.longpolling_timeout_ms);
        if (Number.isFinite(suggested) && suggested > 0) {
          this.#pollTimeoutMs = Math.min(Math.max(suggested, 5000), 60000);
        }

        backoff = this.#reconnectBaseMs;
        this.connected = true;
        this.#emit({ connected: true });

        for (const message of Array.isArray(response?.msgs) ? response.msgs : []) {
          if (this.#stopped) break;
          const key = messageKeyOf(message);
          if (key && this.#seen.seen(key)) {
            this.#log?.debug?.('ilink: 跳过重复消息', { id: key });
            continue;
          }
          try {
            const pending = this.#onMessage?.(message);
            if (pending && typeof pending.catch === 'function') {
              pending.catch((err) => this.#log?.warn?.('ilink: 入站消息处理失败', { error: msgOf(err) }));
            }
          } catch (err) {
            this.#log?.warn?.('ilink: 入站消息处理失败', { error: msgOf(err) });
          }
        }
      } catch (err) {
        if (this.#stopped) return;
        if (err?.status === 401 || err?.status === 403) {
          this.connected = false;
          this.#emit({ connected: false, expired: true, error: `HTTP ${err.status}` });
          return;
        }
        this.connected = false;
        this.#emit({ connected: false, error: msgOf(err) });
        this.#log?.warn?.('ilink: 轮询失败，准备重连', { error: msgOf(err), backoffMs: backoff });
        await this.#sleep(backoff);
        backoff = Math.min(backoff * 2, this.#reconnectMaxMs);
      }
    }
  }

  #sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#wake = null;
        resolve();
      }, ms);
      this.#wake = () => {
        clearTimeout(timer);
        this.#wake = null;
        resolve();
      };
    });
  }

  #emit(status) {
    try {
      this.#onStatus?.(status);
    } catch (err) {
      this.#log?.warn?.('ilink: 连接状态回调失败', { error: msgOf(err) });
    }
  }
}
