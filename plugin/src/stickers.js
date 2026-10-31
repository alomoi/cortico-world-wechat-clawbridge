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
import { join } from 'node:path';

/** 支持的图片扩展名（按优先级尝试）。 */
export const STICKER_EXTS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** `sticker:害羞` → `害羞`；不是表情包引用则返回空串。 */
export function stickerNameOf(ref) {
  const m = /^sticker:(.+)$/i.exec(String(ref ?? '').trim());
  return m ? m[1].trim() : '';
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
  const key = String(name ?? '').trim();
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
          const path = join(root, file.trim());
          if (await isFile(path)) return { path, name: key };
        }
      }
    } catch {
      /* 没有 index.json 或格式不对，继续按扩展名找 */
    }

    // 2) 同名文件
    for (const ext of STICKER_EXTS) {
      const path = join(root, `${key}.${ext}`);
      if (await isFile(path)) return { path, name: key };
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
