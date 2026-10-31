/**
 * 过期文件清理：删掉 `<dataDir>/clawbot/blobs` 与 `media` 里太旧的文件。
 *
 * 只删这两处自己下的文件，不递归进别的地方；任何一次删除失败都只记数，不抛错。
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} dir 目标目录
 * @param {object} [opts]
 * @param {number} [opts.days] 保留天数；<=0 表示不清理
 * @param {number} [opts.now] 当前时间戳（测试用）
 * @returns {Promise<{ removed: number, kept: number, failed: number, bytes: number, skipped?: string }>}
 */
export async function cleanOldFiles(dir, { days = 7, now = Date.now() } = {}) {
  const keepDays = Number(days);
  if (!Number.isFinite(keepDays) || keepDays <= 0) {
    return { removed: 0, kept: 0, failed: 0, bytes: 0, skipped: 'disabled' };
  }

  const cutoff = Number(now) - keepDays * DAY_MS;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return { removed: 0, kept: 0, failed: 0, bytes: 0, skipped: 'missing' };
  }

  let removed = 0;
  let kept = 0;
  let failed = 0;
  let bytes = 0;

  for (const name of names) {
    const path = join(dir, name);
    let info;
    try {
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

  return { removed, kept, failed, bytes };
}
