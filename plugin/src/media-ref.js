/**
 * 媒体引用存储。
 *
 * 入站媒体（图片/语音/文件/视频）的下载参数与解密密钥是能换取用户内容的凭证：
 * 不能进事件 meta，不能进日志，也不能写进 config.json。
 *
 * 这里按消息键把它们存到 `<dataDir>/clawbot/media/<key>.json`，
 * 写盘方式与 ILinkStore 一致（临时文件 + 原子 rename + 0600）。
 *
 * 事件里只保留 `msgId`；需要取媒体时用 `mediaKey(msgId, index)` 回查。
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { downloadMedia, saveBlob, sniffVideoExt } from './media.js';
import { saveNamedFile, sanitizeFileName } from './files.js';

const MEDIA_KIND = { 2: 'image', 3: 'voice', 4: 'file', 5: 'video' };

/** 文件名只允许安全字符，避免消息 id 里的冒号等落到路径上。 */
function safeKey(key) {
  const value = String(key ?? '').replace(/[^0-9A-Za-z_.-]/g, '_');
  return value.slice(0, 80) || 'unknown';
}

/** 一条消息内第 index 个媒体 item 的存储键。 */
export function mediaKey(msgId, index) {
  return `${safeKey(msgId)}-${Number(index) || 0}`;
}

/**
 * 从一条 item 里抽取媒体引用。
 *
 * 同时保留 `full_url` 与 `encrypt_query_param`：前者通常带签名可直接下载，
 * 后者用于 CDN 地址失效时自行拼下载链接。
 * 没有可下载媒体（缺 url 与 query param）时返回 null。
 */
export function mediaRefOf(item, msgId, index) {
  const type = Number(item?.type);
  const kind = MEDIA_KIND[type];
  if (!kind) return null;

  const node = item?.[`${kind}_item`];
  const media = node?.media;
  const url = String(media?.full_url ?? '').trim();
  const queryParam = String(media?.encrypt_query_param ?? '').trim();
  if (!url && !queryParam) return null;

  // 图片有两条密钥来源：item 里的 32 位 hex（aeskey）与 media 里的 base64（aes_key）。
  const aesKey = String(media?.aes_key ?? '').trim();
  const aesKeyHex = String(node?.aeskey ?? '').trim();

  return {
    key: mediaKey(msgId, index),
    kind,
    msgId: String(msgId ?? ''),
    index: Number(index) || 0,
    url,
    queryParam,
    ...(aesKey ? { aesKey } : {}),
    ...(aesKeyHex ? { aesKeyHex } : {}),
    ...(kind === 'image' ? { size: Number(node?.mid_size) || 0 } : {}),
    ...(kind === 'video'
      ? {
        // `video_size` 的语义没实测过，只作参考；下载上限由实际字节兜底。
        size: Number(node?.video_size) || 0,
        playtime: Number(node?.play_length) || 0,
      }
      : {}),
    ...(kind === 'voice' ? { playtime: Number(node?.playtime) || 0 } : {}),
    ...(kind === 'file' ? { name: String(node?.file_name ?? ''), size: Number(node?.len) || 0 } : {}),
  };
}

/**
 * 把已落盘的图片整理成事件附件（`BlobInput`）。
 *
 * 只在 `enabled` 为真、且当前模型接受该 MIME 时才附加；
 * 模型不支持视觉时返回空数组，退回“正文带路径”，不浪费一次请求。
 */
export function imageBlobsFor(attachments, { enabled = false, modelFacts = null, log = null } = {}) {
  if (!enabled) return [];
  if (!attachments || attachments.size === 0) return [];

  let accepts = null;
  try {
    if (modelFacts && typeof modelFacts.accepts === 'function') {
      accepts = (mime) => modelFacts.accepts(mime);
    }
  } catch {
    accepts = null;
  }

  const blobs = [];
  let order = 0;
  for (const attachment of attachments.values()) {
    order += 1;
    if (!attachment?.bytes || !attachment?.mime) continue;
    if (accepts) {
      let supported = true;
      try {
        supported = accepts(attachment.mime) !== false;
      } catch {
        // 探测失败时按“支持”处理，让核心层自己决定是否降级。
        supported = true;
      }
      if (!supported) {
        log?.info?.('clawbridge: 当前模型不接受该图片类型，改为仅提供路径', { mime: attachment.mime });
        return [];
      }
    }
    const ext = attachment.mime.split('/')[1] ?? 'bin';
    blobs.push({
      bytes: attachment.bytes,
      mime: attachment.mime,
      name: `wechat-${order}.${ext}`,
      fallbackText: `[图片 ${order}/${attachments.size}]`,
    });
  }
  return blobs;
}

export class MediaRefStore {
  #dir;
  #log;

  constructor(dir, log = null) {
    this.#dir = dir;
    this.#log = log;
  }

  get dir() {
    return this.#dir;
  }

  #path(key) {
    return join(this.#dir, `${safeKey(key)}.json`);
  }

  async save(key, ref) {
    await mkdir(this.#dir, { recursive: true });
    const file = this.#path(key);
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(ref, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
    try {
      await chmod(file, 0o600);
    } catch {
      /* Windows 不保证 chmod，文件仍在部署数据目录内。 */
    }
  }

  async load(key) {
    try {
      return JSON.parse(await readFile(this.#path(key), 'utf8'));
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        this.#log?.warn?.('clawbot: 媒体引用读不出来', {
          key: safeKey(key),
          error: String(err?.message ?? err),
        });
      }
      return null;
    }
  }

  async remove(key) {
    await rm(this.#path(key), { force: true });
  }
}

/**
 * 处理一条入站消息里的媒体：先存凭证，再按需下载解密落盘。
 *
 * 下载规则：
 *   - 图片：按 `download` 开关，下载后按文件头识别扩展名落 `blobs/`；
 *   - 文件：**还要总开关 `fileTransfer`**，落 `blobs/` 且保留（消毒后的）原文件名；
 *   - 视频：与文件同一条路（同一开关、同一上限），落 `blobs/` 并按容器头命名
 *     `wx-video.<mp4|webm|avi|flv|bin>`；**不抽帧、不解析**，只给路径；
 *   - 以上三者都不带 `bytes` 字段（除图片有意附带），所以不会被动送进模型。
 *   - 语音：不下载（已有微信转写文本），凭证照存。
 *
 * 任何失败都只记日志并继续下一条——消息本身不能被媒体拖死。
 *
 * @returns {Promise<Map<number, { path: string, mime: string|null, bytes?: Buffer, name?: string, size?: number }>>}
 */
export async function captureMediaItems({
  message,
  from,
  store,
  blobsDir,
  fetchImpl = globalThis.fetch,
  maxBytes,
  maxFileBytes = maxBytes,
  fileTransfer = false,
  log = null,
  download = true,
}) {
  const attachments = new Map();
  const msgId = String(message?.message_id ?? '').trim();
  if (!msgId) return attachments;

  const items = Array.isArray(message?.item_list) ? message.item_list : [];
  for (let index = 0; index < items.length; index += 1) {
    const ref = mediaRefOf(items[index], msgId, index);
    if (!ref) continue;

    const record = { ...ref, from, at: new Date().toISOString() };
    try {
      await store.save(ref.key, record);
    } catch (err) {
      log?.warn?.('clawbot: 媒体引用没存下来', { key: ref.key, error: String(err?.message ?? err) });
    }

    if (!download) continue;

    if (ref.kind === 'image') {
      try {
        const result = await downloadMedia(record, { fetchImpl, maxBytes });
        if (!result.mime || !result.ext) {
          throw Object.assign(new Error('无法识别的图片格式'), { code: 'unsupported' });
        }
        const path = await saveBlob(blobsDir, result.bytes, result.ext);
        attachments.set(index, { path, mime: result.mime, bytes: result.bytes });
        await store.save(ref.key, {
          ...record,
          blobPath: path,
          mime: result.mime,
          bytes: result.bytes.length,
          ...(result.sizeMatches === null ? {} : { sizeMatches: result.sizeMatches }),
          downloadedAt: new Date().toISOString(),
        });
      } catch (err) {
        log?.warn?.('clawbot: 图片下载失败', {
          key: ref.key,
          code: err?.code ?? '',
          error: String(err?.message ?? err),
        });
      }
      continue;
    }

    // 文件与视频：都按「临时文件」处理，只有总开关打开才下载
    if (ref.kind !== 'file' && ref.kind !== 'video') continue;

    const isVideo = ref.kind === 'video';
    const playtime = Number(ref.playtime) || 0;
    const rawName = isVideo ? 'wx-video' : sanitizeFileName(ref.name || 'file');
    const skipBase = isVideo ? { skipped: 'disabled', video: true, playtime } : { skipped: 'disabled', name: rawName };

    if (!fileTransfer) {
      attachments.set(index, skipBase);
      continue;
    }

    // 文件能用事件里的 `len` 先挡一次；视频的 `video_size` 语义没实测过，
    // 不拿它当判据，统一交给下载时的字节上限兜底。
    const declared = Number(ref.size) || 0;
    if (!isVideo && declared > maxFileBytes) {
      log?.info?.('clawbot: 文件超过上限，未下载', { key: ref.key, size: declared, max: maxFileBytes });
      attachments.set(index, { skipped: 'too-large', name: rawName, size: declared, limit: maxFileBytes });
      try {
        await store.save(ref.key, { ...record, skipped: 'too-large', size: declared });
      } catch {
        /* 凭证写不进去不影响消息投递 */
      }
      continue;
    }

    try {
      const result = await downloadMedia(record, { fetchImpl, maxBytes: maxFileBytes });
      // 视频用容器头起名（`.bin` 连人都不认识）；文件保留消毒后的原名
      const name = isVideo ? `${rawName}.${sniffVideoExt(result.bytes) ?? 'bin'}` : rawName;
      const saved = await saveNamedFile(blobsDir, result.bytes, name);
      // 不给 bytes：文件/视频都不进模型附件（要不要读由宿主决定）
      attachments.set(index, {
        path: saved.path,
        size: result.bytes.length,
        ...(isVideo ? { video: true, playtime } : { name: rawName }),
      });
      await store.save(ref.key, {
        ...record,
        blobPath: saved.path,
        savedName: saved.name,
        mime: result.mime ?? '',
        bytes: result.bytes.length,
        downloadedAt: new Date().toISOString(),
      });
    } catch (err) {
      const fallback = isVideo
        ? { skipped: err?.code === 'too-large' ? 'too-large' : 'failed', video: true, playtime, limit: maxFileBytes }
        : { skipped: err?.code === 'too-large' ? 'too-large' : 'failed', name: rawName, limit: maxFileBytes };
      attachments.set(index, fallback);
      log?.warn?.(isVideo ? 'clawbot: 视频下载失败' : 'clawbot: 文件下载失败', {
        key: ref.key,
        code: err?.code ?? '',
        error: String(err?.message ?? err),
      });
    }
  }

  return attachments;
}
