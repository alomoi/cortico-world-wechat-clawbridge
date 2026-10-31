/**
 * 送模型前的图片降采样。
 *
 * 为什么：DeepSeek 按**像素**折算 token（单图封顶 1024），所以长边越小越省。
 * 但小于约 544 的图会被上游**放大**回 544 附近，再往下缩不省钱——所以有下限。
 *
 *   960×960 ≈ 92 万像素（约 560 token）
 *   768×768 ≈ 59 万像素（−36%）
 *   544×544 ≈ 30 万像素（−68%，再小没意义）
 *
 * 只处理「送模型的那一份」，落盘的原图不动（桌宠还要能把原图发回去/存起来）。
 * 任何失败都原样返回，绝不因为缩图把链路搞挂。
 */
import { Jimp } from 'jimp';

/** 供测试造图用（依赖装在 plugin 下，tests/ 里 import 不到）。 */
export { Jimp };

export const DEFAULT_MAX_EDGE = 768;
export const DEFAULT_QUALITY = 82;
/** 低于这个边长就不再缩（缩了也会被上游放大，省不到 token）。 */
export const MIN_EDGE = 544;
/**
 * 像素降幅低于这个比例就不重编码。
 * 只比目标大一点点的图，缩完像素没少多少，文件反而可能变大（JPEG 重编码开销）。
 */
export const MIN_GAIN = 0.1;

/**
 * @param {Buffer|Uint8Array} bytes 原始图片字节
 * @param {object} [opts]
 * @param {number} [opts.maxEdge] 长边目标（0 或负数表示关闭）
 * @param {number} [opts.quality] JPEG 质量
 * @param {string} [opts.mime] 原始 mime（gif 直接跳过）
 * @returns {Promise<{
 *   bytes: Buffer, changed: boolean, reason?: string, mime?: string,
 *   width?: number, height?: number, from?: { width: number, height: number },
 *   inputBytes?: number, outputBytes?: number,
 * }>}
 */
export async function downscaleForModel(bytes, { maxEdge = DEFAULT_MAX_EDGE, quality = DEFAULT_QUALITY, mime = '' } = {}) {
  const input = Buffer.from(bytes ?? []);
  if (input.length === 0) return { bytes: input, changed: false, reason: 'empty' };

  const edge = Number(maxEdge);
  if (!Number.isFinite(edge) || edge <= 0) return { bytes: input, changed: false, reason: 'disabled' };

  // 动图缩了会丢帧，直接跳过
  if (/gif/i.test(String(mime))) return { bytes: input, changed: false, reason: 'gif' };

  const target = Math.max(MIN_EDGE, Math.floor(edge));

  let image;
  try {
    image = await Jimp.read(input);
  } catch {
    return { bytes: input, changed: false, reason: 'unreadable' };
  }

  const width = image.bitmap?.width ?? 0;
  const height = image.bitmap?.height ?? 0;
  const longest = Math.max(width, height);
  if (!longest) return { bytes: input, changed: false, reason: 'unreadable' };
  if (longest <= target) {
    return { bytes: input, changed: false, reason: 'small', width, height };
  }

  try {
    image.scaleToFit({ w: target, h: target });
    const newPx = (image.bitmap.width ?? 0) * (image.bitmap.height ?? 0);
    const gain = width * height > 0 ? 1 - newPx / (width * height) : 0;
    if (gain < MIN_GAIN) {
      return { bytes: input, changed: false, reason: 'marginal', width, height };
    }
    const out = await image.getBuffer('image/jpeg', {
      quality: Math.min(100, Math.max(40, Number(quality) || DEFAULT_QUALITY)),
    });
    return {
      bytes: Buffer.from(out),
      changed: true,
      mime: 'image/jpeg',
      width: image.bitmap.width,
      height: image.bitmap.height,
      from: { width, height },
      inputBytes: input.length,
      outputBytes: out.length,
    };
  } catch {
    return { bytes: input, changed: false, reason: 'failed', width, height };
  }
}
