/**
 * 过期文件清理：删掉 `<dataDir>/clawbot/blobs` 与 `media` 里太旧的文件。
 *
 * 两条铁律（删东西不可逆，宁可留垃圾）：
 *   1. **只在本目录里、只删普通文件**，不递归、不动子目录、不动软链指向的目标；
 *   2. **只删我们按命名规则生成的文件**（`onlyOwn`）。用户往 blobs 里塞的收藏、
 *      或者别的程序放的文件，一律跳过并在日志里写明跳过了几个。
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 判断某个文件名是不是本插件生成的那几类：
 * - `20261109-165204-大鱼.mp3`   1.7.0 起收下的文件/视频（时间戳前缀）
 * - `1793171866056-7ac8b805.jpg` 收下的图片（毫秒时间戳-随机 hex.扩展名）
 * - `mid-in-1-0.json`            媒体凭证（清洗过的消息 id + 序号）
 *
 * 不符合的一律当「用户自己的东西」。
 */
export function isBridgeFile(name) {
  const value = String(name ?? '');
  if (!value) return false;
  if (/^\d{8}-\d{6}-/.test(value)) return true;
  if (/^\d{13}-[0-9a-f]{8}\.[0-9a-z]+$/i.test(value)) return true;
  if (/^[0-9A-Za-z_.-]+-\d+\.json$/.test(value)) return true;
  return false;
}

/**
 * @param {string} dir 目标目录
 * @param {object} [opts]
 * @param {number} [opts.days] 保留天数；<=0 表示不清理
 * @param {number} [opts.now] 当前时间戳（测试用）
 * @param {boolean} [opts.onlyOwn] 只删 {@link isBridgeFile} 认可的文件名（默认 true）
 * @returns {Promise<{ removed: number, kept: number, failed: number, bytes: number,
 *                     foreign: number, skipped?: string }>}
 */
export async function cleanOldFiles(dir, { days = 7, now = Date.now(), onlyOwn = true } = {}) {
  const keepDays = Number(days);
  if (!Number.isFinite(keepDays) || keepDays <= 0) {
    return { removed: 0, kept: 0, failed: 0, bytes: 0, foreign: 0, skipped: 'disabled' };
  }

  const cutoff = Number(now) - keepDays * DAY_MS;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return { removed: 0, kept: 0, failed: 0, bytes: 0, foreign: 0, skipped: 'missing' };
  }

  let removed = 0;
  let kept = 0;
  let failed = 0;
  let noteSkipped = 0;
  let bytes = 0;

  for (const name of names) {
    // 先按名字筛：不是我们生成的一律不碰（哪怕很旧）
    if (onlyOwn && !isBridgeFile(name)) {
      noteSkipped += 1;
      continue;
    }

    const path = join(dir, name);
    let info;
    try {
      // lstat 语义：软链本身按「非普通文件」处理，不会被跟着删到目标
      info = await stat(path);
    } catch {
      failed += 1;
      continue;
    }
    if (!info.isFile()) {
      kept += 1;
      continue;
    }
    if (info.mtimeMs >= cutoff) {
      kept += 1;
      continue;
    }
    try {
      await unlink(path);
      removed += 1;
      bytes += info.size;
    } catch {
      failed += 1;
    }
  }

  return { removed, kept, failed, bytes, foreign: noteSkipped };
}
