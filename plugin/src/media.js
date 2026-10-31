/**
 * 微信媒体下载与解密。
 *
 * 入站媒体的密文走 CDN：优先用事件里的 `full_url`（带签名的直链，有时效），
 * 没有就按 `encrypt_query_param` 自己拼下载地址。
 *
 * 加密方式固定为 AES-128-ECB + PKCS#7 填充，密钥有两种写法：
 *   - `aes_key`：base64，解码后可能是 32 位十六进制字符串，也可能是 16 字节原始密钥
 *   - `aeskey`（图片专有）：32 位十六进制字符串（未编码）
 *
 * 明文大小等于事件里的 `mid_size`（图片），密文比它多出补位字节——
 * 校验完整性请用明文长度，不要用密文长度。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** DeepSeek inline 单图上限；超过就没必要下载了。 */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c';

const MAGIC = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const mediaError = (code, message, cause) => Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) });

/** 由引用拼出下载地址：优先 full_url，其次按 encrypt_query_param 自拼。 */
export function downloadUrlOf(ref) {
  const url = String(ref?.url ?? '').trim();
  if (url) return url;
  const queryParam = String(ref?.queryParam ?? '').trim();
  if (!queryParam) return null;
  return `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(queryParam)}`;
}

/**
 * 解析出 16 字节 AES 密钥。
 *
 * 兼容三种形态：aes_key 为 base64(32 hex)、base64(16 字节)，以及图片的
 * 裸 32 位 hex `aeskey`。都解析不出来时返回 null（表示未加密）。
 */
export function decodeAesKey(ref) {
  const raw = String(ref?.aesKey ?? '').trim();
  if (raw) {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 16) return decoded;
    if (decoded.length === 32) {
      const text = decoded.toString('utf8');
      if (/^[0-9a-fA-F]{32}$/.test(text)) return Buffer.from(text, 'hex');
    }
  }
  const hex = String(ref?.aesKeyHex ?? '').trim();
  if (/^[0-9a-fA-F]{32}$/.test(hex)) return Buffer.from(hex, 'hex');
  return null;
}

/** AES-128-ECB 解密（自动去 PKCS#7 填充）。 */
export function decryptAesEcb(cipher, key) {
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(cipher), decipher.final()]);
}

/** 按文件头识别媒体类型；识别不出返回 null。 */
export function sniffMedia(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const hit = MAGIC.find((entry) => entry.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/**
 * 下载并按需解密一件媒体。
 *
 * @returns {{ bytes: Buffer, mime: string|null, ext: string|null,
 *             encrypted: boolean, sizeMatches: boolean|null }}
 */
export async function downloadMedia(ref, {
  fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const url = downloadUrlOf(ref);
  if (!url) throw mediaError('no-url', '媒体引用里既没有 full_url 也没有 encrypt_query_param');

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw mediaError('download-failed', `下载失败：${err?.message ?? err}`, err);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw mediaError('http', `下载返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw mediaError('too-large', `媒体过大：${declared} B 超过上限 ${maxBytes} B`);
  }

  const cipher = Buffer.from(await response.arrayBuffer());
  if (cipher.length > maxBytes + 16) {
    throw mediaError('too-large', `媒体过大：${cipher.length} B 超过上限 ${maxBytes} B`);
  }

  const key = decodeAesKey(ref);
  let bytes = cipher;
  if (key) {
    try {
      bytes = decryptAesEcb(cipher, key);
    } catch (err) {
      throw mediaError('decrypt-failed', `解密失败：${err?.message ?? err}`, err);
    }
  }

  const sniffed = sniffMedia(bytes);
  const expected = Number(ref?.size);
  const sizeMatches = Number.isFinite(expected) && expected > 0 && ref?.kind === 'image'
    ? bytes.length === expected
    : null;

  return {
    bytes,
    mime: sniffed?.mime ?? null,
    ext: sniffed?.ext ?? null,
    encrypted: Boolean(key),
    sizeMatches,
  };
}

/** 以随机文件名落盘，返回绝对路径。 */
export async function saveBlob(dir, bytes, ext = 'bin') {
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
  const file = join(dir, name);
  await writeFile(file, bytes, { mode: 0o600 });
  return file;
}

/** AES-128-ECB 加密（PKCS#7 补位），与 {@link decryptAesEcb} 对称。 */
export function encryptAesEcb(plain, key) {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

/** 明文的 32 位小写 hex md5。 */
export function md5Hex(bytes) {
  return createHash('md5').update(bytes).digest('hex');
}

/** 生成 32 位小写 hex 的 AES-128 密钥。 */
export function randomKeyHex() {
  return randomBytes(16).toString('hex');
}

/**
 * 把一段明文整理成上传所需的一切。
 *
 * @param {Buffer|Uint8Array} bytes 明文
 * @param {{ keyHex?: string }} [opts] 可指定密钥；缺省随机生成
 * @returns {{ keyHex: string, key: Buffer, cipher: Buffer, rawSize: number, cipherSize: number, rawMd5: string }}
 */
export function prepareMediaUpload(bytes, { keyHex } = {}) {
  const plain = Buffer.from(bytes ?? []);
  const hex = /^[0-9a-fA-F]{32}$/.test(String(keyHex ?? '')) ? String(keyHex).toLowerCase() : randomKeyHex();
  const key = Buffer.from(hex, 'hex');
  const cipher = encryptAesEcb(plain, key);
  return {
    keyHex: hex,
    key,
    cipher,
    rawSize: plain.length,
    cipherSize: cipher.length,
    rawMd5: md5Hex(plain),
  };
}
