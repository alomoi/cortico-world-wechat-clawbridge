/**
 * 路径归属判断：图片（及未来其它文件）只允许从白名单目录里读。
 *
 * 细节：必须按分隔符边界比较，否则 `…/blobs-evil` 会被误判为 `…/blobs` 的子路径。
 */
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
