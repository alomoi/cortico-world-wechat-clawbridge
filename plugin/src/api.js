/**
 * iLink HTTP 客户端。
 *
 * 请求与响应形状来自腾讯官方 @tencent-weixin/openclaw-weixin 2.4.10；
 * 这里只实现 1v1 文本通道需要的四个调用：取二维码、查扫码状态、
 * 长轮询收消息、发消息。
 */
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';

const pkg = createRequire(import.meta.url)('../package.json');

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CHANNEL_VERSION = String(pkg.version ?? '0.0.0');
export const MAX_TEXT_CHARS = 4000;

/** 官方通道 2.4.10 的客户端版本编码：(2<<16)|(4<<8)|10。协议按这个版本校验。 */
const HEADER_CLIENT_VERSION = 132106;
const APP_ID = 'bot';
const API_TIMEOUT_MS = 15000;
const LONG_POLL_TIMEOUT_MS = 35000;

export class ILinkError extends Error {
  constructor(message, { status, ret, errcode, stage, detail } = {}) {
    super(message);
    this.name = 'ILinkError';
    if (status !== undefined) this.status = status;
    if (ret !== undefined) this.ret = ret;
    if (errcode !== undefined) this.errcode = errcode;
    if (stage !== undefined) this.stage = stage;
    if (detail !== undefined) this.detail = detail;
  }
}

export function isAbort(err) {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

const ensureSlash = (value) => (String(value ?? '').endsWith('/') ? String(value) : `${String(value)}/`);

function randomWechatUin() {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function baseInfo() {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: `Cortico/${CHANNEL_VERSION}`,
  };
}

function headersFor({ token, post }) {
  const headers = {
    'iLink-App-Id': APP_ID,
    'iLink-App-ClientVersion': String(HEADER_CLIENT_VERSION),
  };
  if (post) {
    headers['Content-Type'] = 'application/json';
    headers.AuthorizationType = 'ilink_bot_token';
    headers['X-WECHAT-UIN'] = randomWechatUin();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function signalFor(timeoutMs, external) {
  const timeout = Number(timeoutMs) > 0 ? AbortSignal.timeout(Number(timeoutMs)) : null;
  if (timeout && external) return AbortSignal.any([timeout, external]);
  return timeout ?? external ?? undefined;
}

/**
 * 把 uint64 消息 id 先包成字符串再 JSON.parse。
 * 只改对象里这几个键的数值，避免 19 位 id 在 JS 里丢精度。
 */
export function quoteBigIds(raw) {
  return String(raw).replace(
    /("(?:message_id|msg_id|svr_id)"\s*:\s*)(-?\d+)/g,
    '$1"$2"',
  );
}

async function request({
  baseUrl,
  endpoint,
  method = 'POST',
  body,
  token,
  timeoutMs,
  signal,
  dispatcher,
  fetchImpl = globalThis.fetch,
}) {
  const url = new URL(endpoint, ensureSlash(baseUrl));
  const where = `${url.host}${url.pathname}`;
  const init = {
    method,
    headers: headersFor({ token, post: body !== undefined }),
    signal: signalFor(timeoutMs, signal),
    ...(dispatcher ? { dispatcher } : {}),
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    if (isAbort(err)) throw err;
    const cause = err?.cause;
    const detail = cause ? ` (${cause.code || cause.message || String(cause)})` : '';
    throw new ILinkError(
      `${method} ${where} failed: ${err instanceof Error ? err.message : String(err)}${detail}`,
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    const detail = raw ? `: ${raw.slice(0, 300)}` : '';
    throw new ILinkError(`${method} ${where} returned HTTP ${response.status}${detail}`, {
      status: response.status,
    });
  }
  if (!raw) return {};
  try {
    return JSON.parse(quoteBigIds(raw));
  } catch {
    throw new ILinkError(`${method} ${where} returned non-JSON`);
  }
}

export async function fetchQrCode({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  dispatcher,
} = {}) {
  const data = await request({
    baseUrl,
    endpoint: 'ilink/bot/get_bot_qrcode?bot_type=3',
    body: { local_token_list: [] },
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
  const qrcode = String(data?.qrcode ?? '').trim();
  const qrUrl = String(data?.qrcode_img_content ?? '').trim();
  if (!qrcode || !qrUrl) throw new ILinkError('二维码响应缺少 qrcode 或 qrcode_img_content');
  return { qrcode, qrUrl };
}

export async function pollQrStatus({
  baseUrl = DEFAULT_BASE_URL,
  qrcode,
  verifyCode = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = LONG_POLL_TIMEOUT_MS,
  signal,
  dispatcher,
} = {}) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    return await request({
      baseUrl,
      endpoint,
      method: 'GET',
      timeoutMs,
      signal,
      dispatcher,
      fetchImpl,
    });
  } catch (err) {
    // 长轮询超时是正常路径：继续等二维码状态。
    if (isAbort(err)) return { status: 'wait' };
    throw err;
  }
}

export async function getUpdates({
  baseUrl,
  token,
  syncBuf = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = LONG_POLL_TIMEOUT_MS,
  signal,
  dispatcher,
} = {}) {
  try {
    return await request({
      baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: { get_updates_buf: syncBuf, base_info: baseInfo() },
      token,
      timeoutMs,
      signal,
      dispatcher,
      fetchImpl,
    });
  } catch (err) {
    if (isAbort(err)) return { ret: 0, msgs: [], get_updates_buf: syncBuf };
    throw err;
  }
}

export async function sendText({
  baseUrl,
  token,
  to,
  text,
  contextToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = API_TIMEOUT_MS,
  dispatcher,
} = {}) {
  const body = {
    msg: {
      from_user_id: '',
      to_user_id: String(to ?? ''),
      client_id: `cortico-ilink-${randomUUID()}`,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text: String(text ?? '') } }],
      ...(contextToken ? { context_token: String(contextToken) } : {}),
    },
    base_info: baseInfo(),
  };
  const data = await request({
    baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body,
    token,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
  if (data?.ret !== undefined && data.ret !== 0) {
    throw new ILinkError(
      `sendmessage ret=${data.ret}${data.errmsg ? ` ${String(data.errmsg)}` : ''}`,
      { ret: data.ret },
    );
  }
  return data;
}

/** 生成 32 位小写 hex 的 AES-128 密钥，用于本次媒体上传。 */
export function randomAesKeyHex() {
  return randomBytes(16).toString('hex');
}

/**
 * 取 bot 配置（含 `typing_ticket`）。
 *
 * 官方实现：`POST ilink/bot/getconfig`，body 为 `ilink_user_id` / `context_token` / `base_info`。
 */
export async function getConfig({
  baseUrl,
  token,
  ilinkUserId,
  contextToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = API_TIMEOUT_MS,
  dispatcher,
} = {}) {
  const body = {
    ilink_user_id: String(ilinkUserId ?? ''),
    ...(contextToken ? { context_token: String(contextToken) } : {}),
    base_info: baseInfo(),
  };
  const data = await request({
    baseUrl,
    endpoint: 'ilink/bot/getconfig',
    body,
    token,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
  if (data?.ret !== undefined && data.ret !== 0) {
    throw new ILinkError(
      `getconfig ret=${data.ret}${data.errmsg ? ` ${String(data.errmsg)}` : ''}`,
      { ret: data.ret, stage: 'getconfig', detail: data.errmsg ? String(data.errmsg) : '' },
    );
  }
  return data;
}

/** 正在输入状态：1 = 输入中，2 = 取消。 */
export const TYPING_STATUS = Object.freeze({ TYPING: 1, CANCEL: 2 });

/**
 * 发送「正在输入」指示。
 *
 * 官方实现：`POST ilink/bot/sendtyping`，body 为 `ilink_user_id` / `typing_ticket` / `status` / `base_info`。
 */
export async function sendTyping({
  baseUrl,
  token,
  to,
  typingTicket,
  status = TYPING_STATUS.TYPING,
  fetchImpl = globalThis.fetch,
  timeoutMs = API_TIMEOUT_MS,
  dispatcher,
} = {}) {
  const body = {
    ilink_user_id: String(to ?? ''),
    ...(typingTicket ? { typing_ticket: String(typingTicket) } : {}),
    status: Number(status) || TYPING_STATUS.TYPING,
    base_info: baseInfo(),
  };
  const data = await request({
    baseUrl,
    endpoint: 'ilink/bot/sendtyping',
    body,
    token,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
  if (data?.ret !== undefined && data.ret !== 0) {
    throw new ILinkError(
      `sendtyping ret=${data.ret}${data.errmsg ? ` ${String(data.errmsg)}` : ''}`,
      { ret: data.ret, stage: 'typing', detail: data.errmsg ? String(data.errmsg) : '' },
    );
  }
  return data;
}

/**
 * 取媒体上传地址。
 *
 * body 形状照官方 2.4.10 的 `getUploadUrl`：
 * `filekey` / `media_type` / `to_user_id` / `rawsize` / `rawfilemd5` / `filesize` / `aeskey` / `no_need_thumb`。
 *
 * 注意：`to_user_id` 是官方实现里必带的字段，漏了会直接 ret=-2（参数错误）。
 */
export async function getUploadUrl({
  baseUrl,
  token,
  filekey,
  mediaType = 1,
  toUserId,
  rawSize,
  rawMd5,
  fileSize,
  aesKeyHex,
  noNeedThumb = true,
  fetchImpl = globalThis.fetch,
  timeoutMs = API_TIMEOUT_MS,
  dispatcher,
} = {}) {
  const body = {
    filekey: String(filekey ?? ''),
    media_type: Number(mediaType) || 1,
    to_user_id: String(toUserId ?? ''),
    rawsize: Number(rawSize) || 0,
    rawfilemd5: String(rawMd5 ?? ''),
    filesize: Number(fileSize ?? rawSize) || 0,
    aeskey: String(aesKeyHex ?? ''),
    no_need_thumb: Boolean(noNeedThumb),
    base_info: baseInfo(),
  };
  const data = await request({
    baseUrl,
    endpoint: 'ilink/bot/getuploadurl',
    body,
    token,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
  const url = String(data?.upload_full_url ?? '').trim();
  const param = String(data?.upload_param ?? '').trim();
  if (data?.ret !== undefined && data.ret !== 0) {
    throw new ILinkError(
      `getuploadurl ret=${data.ret}${data.errmsg ? ` ${String(data.errmsg)}` : ''}`,
      { ret: data.ret, stage: 'getuploadurl', detail: data.errmsg ? String(data.errmsg) : '', response: data },
    );
  }
  if (!url && !param) {
    throw new ILinkError(
      `getuploadurl 响应缺少 upload 地址${data ? `: ${JSON.stringify(data).slice(0, 120)}` : ''}`,
      { stage: 'getuploadurl', detail: data ? JSON.stringify(data).slice(0, 200) : '' },
    );
  }
  return { url, param, raw: data };
}

/**
 * 把密文 POST 到上传地址，返回响应头里的 `x-encrypted-param`。
 *
 * 这是后续构造 `image_item.media.encrypt_query_param` 要用的参数。
 */
export async function uploadCiphertext({
  url,
  ciphertext,
  fetchImpl = globalThis.fetch,
  timeoutMs = API_TIMEOUT_MS,
  dispatcher,
  signal,
} = {}) {
  if (!url) throw new ILinkError('上传地址为空', { stage: 'upload' });
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext,
    signal: signalFor(timeoutMs, signal),
    ...(dispatcher ? { dispatcher } : {}),
  };
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    if (isAbort(err)) throw err;
    const cause = err?.cause;
    const detail = cause ? ` (${cause.code || cause.message || String(cause)})` : '';
    throw new ILinkError(`上传失败：${err?.message ?? err}${detail}`, { stage: 'upload' });
  }
  if (!response.ok) {
    // 官方实现读 x-error-message 头；CDN 拒收时原因通常只在这里
    let headerMsg = '';
    try {
      headerMsg = String(response.headers?.get?.('x-error-message') ?? '').trim();
    } catch {
      headerMsg = '';
    }
    let bodyText = '';
    try {
      bodyText = String(await response.text()).slice(0, 200).trim();
    } catch {
      bodyText = '';
    }
    const detail = headerMsg || bodyText;
    throw new ILinkError(
      `上传返回 HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      { status: response.status, stage: 'upload', detail },
    );
  }
  const param = String(response.headers?.get?.('x-encrypted-param') ?? '').trim();
  if (!param) throw new ILinkError('上传响应缺少 x-encrypted-param', { stage: 'upload' });
  return param;
}

/**
 * 发送一条图片消息。
 *
 * `encryptQueryParam` 来自 {@link uploadCiphertext}；`aesKeyHex` 是本次上传用的 32 位 hex 密钥。
 * `midSize` 的语义官方注释与实测不一致（收侧实测是明文大小），默认按密文长度传，
 * 调用方可显式指定。
 */
export async function sendImage({
  baseUrl,
  token,
  to,
  encryptQueryParam,
  aesKeyHex,
  midSize,
  contextToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = API_TIMEOUT_MS,
  dispatcher,
} = {}) {
  const keyHex = String(aesKeyHex ?? '');
  const body = {
    msg: {
      from_user_id: '',
      to_user_id: String(to ?? ''),
      client_id: `cortico-ilink-${randomUUID()}`,
      message_type: 2,
      message_state: 2,
      item_list: [{
        type: 2,
        image_item: {
          media: {
            encrypt_query_param: String(encryptQueryParam ?? ''),
            aes_key: Buffer.from(keyHex, 'utf8').toString('base64'),
            encrypt_type: 1,
          },
          mid_size: Number(midSize) || 0,
        },
      }],
      ...(contextToken ? { context_token: String(contextToken) } : {}),
    },
    base_info: baseInfo(),
  };
  const data = await request({
    baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body,
    token,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
  if (data?.ret !== undefined && data.ret !== 0) {
    throw new ILinkError(
      `sendmessage ret=${data.ret}${data.errmsg ? ` ${String(data.errmsg)}` : ''}`,
      {
        ret: data.ret,
        stage: 'sendmessage',
        detail: data.errmsg ? String(data.errmsg) : '',
        response: data,
      },
    );
  }
  return data;
}
