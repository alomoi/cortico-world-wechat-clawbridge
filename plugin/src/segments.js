/**
 * 把一段「脚本」切成多条微信消息。
 *
 * 语法沿用 Coopanion 的气泡约定：`【…】` 表示换一条消息。
 * 标记本身不产生内容；`resolveMarker()` 可以为标记注入一段前缀文字
 * （S3 的表情替换就挂在这里，默认注入空串）。
 *
 * 规则：
 * - 标记内容最多 MARKER_MAX 个字符且不含换行，否则当普通文本；
 * - 连续标记合并，不产生空消息；
 * - 行尾标记的内容贴到前一段末尾，行首标记贴到后一段开头；
 * - 超过 maxSegments 的部分并进最后一条，不丢内容。
 */

const MARKER_RE = /【([^】\n]{0,24})】/g;
/** 标记内容的最大长度（码点）。超过当普通文本。 */
const MARKER_MAX = 12;
/** 行内标记：`<wink>`，不换消息，就地替换。 */
const INLINE_RE = /<([^<>\n]{0,24})>/g;

const countChars = (s) => [...s].length;

/**
 * 展开行内标记 `<…>`：就地替换成表情，不产生分段。
 *
 * 只处理**已知词**（由 `isKnownMarker` 判定），其余原样保留——
 * 这样 `<div>`、`a<b` 之类的普通文本不会被误伤。
 */
function expandInline(text, { resolveMarker, isKnownMarker }) {
  if (!text.includes('<')) return text;
  return text.replace(INLINE_RE, (whole, raw) => {
    const word = String(raw ?? '').trim();
    if (!word || countChars(word) > MARKER_MAX) return whole;
    let known = false;
    try {
      known = isKnownMarker(word) === true;
    } catch {
      known = false;
    }
    if (!known) return whole;
    let emoji = '';
    try {
      emoji = String(resolveMarker(word) ?? '');
    } catch {
      emoji = '';
    }
    return emoji;
  });
}

/**
 * @param {string} script
 * @param {object} [opts]
 * @param {number} [opts.maxSegments] - 最多几条消息（默认 4）
 * @param {(word: string) => string} [opts.resolveMarker] - 标记 → 文字
 * @param {(word: string) => boolean} [opts.isKnownMarker] - 是否已知词（行内标记只认已知词）
 * @returns {{ segments: string[], markers: string[], truncated: boolean }}
 */
export function splitScript(script, {
  maxSegments = 4,
  resolveMarker = () => '',
  isKnownMarker = () => false,
} = {}) {
  const raw = String(script ?? '');
  const text = expandInline(raw, { resolveMarker, isKnownMarker });
  const limit = Math.max(1, Math.floor(Number(maxSegments) || 4));

  const pieces = [];
  let last = 0;
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const word = m[1].trim();
    // 空标记 `【】` 是纯分隔符；过长的当普通文本
    if (countChars(word) > MARKER_MAX) continue;
    if (m.index > last) pieces.push({ type: 'text', value: text.slice(last, m.index) });
    pieces.push({ type: 'marker', value: word });
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push({ type: 'text', value: text.slice(last) });

  const markers = pieces.filter((p) => p.type === 'marker').map((p) => p.value);
  const segments = [];
  let current = '';
  let prefix = '';

  const flush = () => {
    const value = `${prefix}${current}`.trim();
    if (value) segments.push(value);
    current = '';
    prefix = '';
  };

  for (const piece of pieces) {
    if (piece.type === 'text') {
      current += piece.value;
      continue;
    }
    // 标记：结束当前段，内容作为下一段的前缀
    flush();
    let injected = '';
    try {
      injected = String(resolveMarker(piece.value) ?? '');
    } catch {
      injected = '';
    }
    prefix = injected;
  }

  // 行尾标记：内容贴到前一条末尾，不单独成条
  if (prefix && segments.length > 0 && current.trim() === '') {
    const lastIndex = segments.length - 1;
    segments[lastIndex] = `${segments[lastIndex]}${prefix}`.trim();
    prefix = '';
  }
  flush();

  let truncated = false;
  if (segments.length > limit) {
    const head = segments.slice(0, limit - 1);
    const tail = segments.slice(limit - 1).join(' ');
    head.push(tail);
    truncated = true;
    return { segments: head, markers, truncated };
  }
  return { segments, markers, truncated };
}
