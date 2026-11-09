/**
 * 文件名与落盘工具。
 *
 * 收文件时 `file_item.file_name` 是**对方给的**，属于外部输入：
 * 直接拼进路径就能写到目录外（`..\..\x`、`C:\x`、`a:b`）。
 * 这里只做两件事：把名字洗成一个安全的 basename，再带时间戳落盘。
 *
 * 纯函数（`sanitizeFileName` / `splitName` / `formatBytes`）与落盘分开，
 * 前者便于测试，后者只碰自己给定的目录。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 文件名最长保留多少字符（Windows 全路径 260 的限制要留余量给目录）。 */
const MAX_NAME = 100;
const FALLBACK = 'file';
/** Windows 保留设备名：带不带扩展名都算保留。 */
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.[^.]*)?$/i;

/** 拆出主干与扩展名；看着不像扩展名的（太长、含空白）整串都当主干。 */
export function splitName(name) {
  const value = String(name ?? '');
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) return { stem: value, ext: '' };
  const tail = value.slice(dot + 1);
  if (tail.length > 5 || !/^[0-9A-Za-z_-]+$/.test(tail)) return { stem: value, ext: '' };
  return { stem: value.slice(0, dot), ext: value.slice(dot) };
}

/**
 * 洗一个安全的文件名。
 *
 * - 只保留最后一段（两种分隔符都认），路径穿越直接消失；
 * - 去掉控制字符与 Windows 非法字符 `<>:"|?*`；
 * - 去掉开头结尾的点与空格（`...`、`name. ` 在 Windows 上会变成奇怪的东西）；
 * - 躲开保留设备名（`CON`、`NUL`…），前面加下划线；
 * - 过长按「主干截断、扩展名保留」处理；
 * - 洗空了退回 `file`。
 */
export function sanitizeFileName(raw, { fallback = FALLBACK, maxLength = MAX_NAME } = {}) {
  let name = String(raw ?? '');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/[<>:"|?*]/g, '');
  name = name.replace(/[. ]+$/g, '').replace(/^[. ]+/g, '');
  if (!name || name === '.' || name === '..') name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  if (name.length > maxLength) {
    const { stem, ext } = splitName(name);
    const keep = Math.max(1, maxLength - ext.length);
    name = `${stem.slice(0, keep)}${ext}`;
  }
  return name || fallback;
}

/** `YYYYMMDD-HHmmss`（本地时间），用来给落盘文件排顺序、防撞名。 */
export function stampOf(now = Date.now()) {
  const date = new Date(Number(now) || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * 按「时间戳-原文件名」落盘，保留对方给的名字（收藏时认得出来）。
 *
 * 撞名时依次加 `-1`、`-2`…；用 `wx` 独占创建，避免两个并发写入互相覆盖。
 *
 * @returns {Promise<{ path: string, name: string }>}
 */
export async function saveNamedFile(dir, bytes, rawName, { now = Date.now(), stamp = '' } = {}) {
  await mkdir(dir, { recursive: true });
  const safe = sanitizeFileName(rawName);
  const { stem, ext } = splitName(safe);
  const prefix = stamp || stampOf(now);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt}`;
    const name = `${prefix}-${stem}${suffix}${ext}`;
    const path = join(dir, name);
    try {
      await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
      return { path, name };
    } catch (err) {
      if (err?.code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('同名文件太多，找不到可用的落盘名');
}

/** 人类可读的大小：`2.3 MB` / `856 B`。 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
