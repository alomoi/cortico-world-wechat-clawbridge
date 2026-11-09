/**
 * 路径归属判断：图片/表情/文件只允许从白名单目录里读。
 *
 * 细节：必须按分隔符边界比较，否则 `…/blobs-evil` 会被误判为 `…/blobs` 的子路径。
 */
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** `abs` 是否等于 `root` 或位于其下。 */
export function isInside(abs, root) {
  const a = resolve(String(abs ?? ''));
  const r = resolve(String(root ?? ''));
  if (!r) return false;
  return a === r || a.startsWith(`${r}${sep}`);
}

/** `abs` 是否落在任一 `roots` 之下。 */
export function isInsideAny(abs, roots) {
  if (!Array.isArray(roots)) return false;
  return roots.some((root) => isInside(abs, root));
}

/**
 * 更严的一版：既看字面路径，也看解析软链后的真实路径。
 *
 * 白名单里放一个指向外面的软链/目录联接（junction），字面检查会通过，
 * 真实路径却在白名单外——这一版把那种情况也挡掉。
 *
 * 目录/文件不存在时就按字面判断（`realpath` 失败不放大权限）。
 */
export async function isInsideAnyResolved(abs, roots) {
  const target = resolve(String(abs ?? ''));
  if (!Array.isArray(roots) || roots.length === 0) return false;

  let realTarget = target;
  try { realTarget = resolve(await realpath(target)); } catch { /* 用字面路径 */ }

  for (const root of roots) {
    const r = resolve(String(root ?? ''));
    if (!r || !isInside(target, r)) continue;
    let realRoot = r;
    try { realRoot = resolve(await realpath(r)); } catch { /* 目录还不存在 */ }
    if (isInside(realTarget, realRoot)) return true;
  }
  return false;
}
