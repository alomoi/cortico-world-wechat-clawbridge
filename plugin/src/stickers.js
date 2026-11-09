/**
 * 图片表情包解析：`sticker:<名字>` → 本地图片路径。
 *
 * 素材放在两个地方的 `stickers/` 目录里（先命中先用）：
 * - `<dataDir>/clawbot/stickers/`
 * - `<companion>/workspace/stickers/`
 *
 * 每个目录可以放一个 `index.json` 做别名映射（`{ "害羞": "shy.png" }`），
 * 没有就按 `<名字>.<png|jpg|jpeg|gif|webp>` 直接找文件。
 *
 * 为什么不做「内置一批素材」：emoji 字体渲染出来的图不能随包分发（授权问题），
 * 所以素材由使用者自己放；`tools/make-stickers.py` 可以在本机一键生成一套自用。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isInside } from './paths.js';

/** 支持的图片扩展名（按优先级尝试）。 */
export const STICKER_EXTS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** `sticker:害羞` → `害羞`；不是表情包引用则返回空串。 */
export function stickerNameOf(ref) {
  const m = /^sticker:(.+)$/i.exec(String(ref ?? '').trim());
  return m ? m[1].trim() : '';
}

/**
 * 合法的表情名：不能带路径分隔符、不能是 `.`/`..`、不能有控制字符、不能过长。
 *
 * 表情名是模型（可能被用户诱导）给的字符串，会拼进文件路径——
 * 不挡住 `../../x` 就等于把白名单写成了一张纸。
 */
export function safeStickerName(name) {
  const value = String(name ?? '').trim();
  if (!value || value.length > 100) return '';
  if (/[\\/\u0000-\u001f\u007f]/.test(value)) return '';
  if (value === '.' || value === '..') return '';
  return value;
}

/**
 * 在 root 下拼一个相对路径，越界就返回 null。
 *
 * `index.json` 的别名值同样来自本地配置，但它是「人写的」不代表「写对的」，
 * 一起校验，省得哪天配错一个 `../../` 又把洞开回去。
 */
function insideRoot(root, relative) {
  const abs = resolve(join(root, String(relative ?? '')));
  return isInside(abs, root) ? abs : null;
}

const isFile = async (path) => {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
};

/**
 * 在若干根目录里找表情包。
 *
 * @param {string} name 表情名（如 `害羞`）
 * @param {string[]} roots 依次尝试的目录
 * @returns {Promise<{ path: string, name: string } | null>}
 */
export async function findSticker(name, roots) {
  const key = safeStickerName(name);
  if (!key || !Array.isArray(roots)) return null;

  for (const root of roots) {
    if (!root) continue;

    // 1) index.json 别名
    try {
      const raw = await readFile(join(root, 'index.json'), 'utf8');
      const map = JSON.parse(raw);
      if (map && typeof map === 'object') {
        const file = map[key] ?? map[key.toLowerCase()];
        if (typeof file === 'string' && file.trim()) {
          const path = insideRoot(root, file.trim());
          if (path && await isFile(path)) return { path, name: key };
        }
      }
    } catch {
      /* 没有 index.json 或格式不对，继续按扩展名找 */
    }

    // 2) 同名文件
    for (const ext of STICKER_EXTS) {
      const path = insideRoot(root, `${key}.${ext}`);
      if (path && await isFile(path)) return { path, name: key };
    }
  }
  return null;
}

/** 列出目录里可用的表情包名字（排错用）。 */
export async function listStickers(roots) {
  const names = new Set();
  for (const root of Array.isArray(roots) ? roots : []) {
    if (!root) continue;
    try {
      const map = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
      if (map && typeof map === 'object') {
        for (const key of Object.keys(map)) names.add(key);
      }
    } catch {
      /* 忽略 */
    }
    let entries = [];
    try {
      entries = await readdir(root);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      for (const ext of STICKER_EXTS) {
        if (lower.endsWith(`.${ext}`)) names.add(entry.slice(0, -(ext.length + 1)));
      }
    }
  }
  return [...names].sort();
}
