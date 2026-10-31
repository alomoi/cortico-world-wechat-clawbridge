/**
 * 给控制台面板用的「最近图片」列表。
 *
 * 只读 `blobs/`，按修改时间倒序，附带一张缩略图（data URL）。
 * 任何一张失败都跳过，不影响整份列表。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Jimp } from 'jimp';

const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp)$/i;

/**
 * @param {string} dir 图片目录（通常是 `<dataDir>/clawbot/blobs`）
 * @param {object} [opts]
 * @param {number} [opts.limit] 最多返回几条（默认 12）
 * @param {number} [opts.thumbEdge] 缩略图长边（默认 200）
 * @param {number} [opts.thumbQuality] 缩略图 JPEG 质量（默认 70）
 * @param {number} [opts.maxBytes] 单张读取上限（默认 20 MiB，超过只给元信息）
 */
export async function listRecentMedia(dir, {
  limit = 12,
  thumbEdge = 200,
  thumbQuality = 70,
  maxBytes = 20 * 1024 * 1024,
} = {}) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const files = [];
  for (const name of names) {
    if (!IMAGE_RE.test(name)) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      files.push({ name, path, size: info.size, at: info.mtimeMs });
    } catch {
      /* 忽略单个失败 */
    }
  }
  files.sort((a, b) => b.at - a.at);

  const picked = files.slice(0, Math.max(1, Math.floor(limit)));
  const items = [];
  for (const file of picked) {
    const item = {
      name: file.name,
      at: new Date(file.at).toISOString(),
      size: file.size,
      width: 0,
      height: 0,
      thumb: '',
    };
    if (file.size > maxBytes) {
      items.push(item);
      continue;
    }
    try {
      const bytes = await readFile(file.path);
      const image = await Jimp.read(bytes);
      item.width = image.bitmap.width;
      item.height = image.bitmap.height;
      image.scaleToFit({ w: thumbEdge, h: thumbEdge });
      const thumb = await image.getBuffer('image/jpeg', { quality: thumbQuality });
      item.thumb = `data:image/jpeg;base64,${Buffer.from(thumb).toString('base64')}`;
    } catch {
      /* 缩略图失败就只给元信息 */
    }
    items.push(item);
  }
  return items;
}
