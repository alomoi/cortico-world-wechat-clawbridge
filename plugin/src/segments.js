/**
 * 把一段「回复文本」切成多条微信消息。
 *
 * **一行一条**（2026-11-18 定案）：换行就是分条，空行只当分隔。
 * 这样规则一句话就能说清，也不用教任何新符号。
 *
 * `【…】` 是 1.7.x 及更早教过的写法，现在**不再写进提示词**，
 * 但解析保留：桌宠以前的气泡习惯、以及形象包里自带 `【…】` 的桌宠都不会漏出括号。
 * 标记本身不产生内容；`resolveMarker()` 可以为标记注入一段前缀文字。
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
 * 模型偶尔会把半截 XML 标签写进正文（实测 `deepseek-flash` 会在 1.7.0 后的单条消息尾部
 * 漏出 `</text>`）。这种标签不是表情、也不是内容，发到微信里只会变成可笑的尾巴。
 *
 * 只剥**已知的包装标签**（text/response/answer/reply/message/output/content），
 * 并且成对或单独都处理；`<div>`、`a<b`、`3 < 5` 这类正常文本不受影响。
 */
const LEAKED_TAG_RE = /<\/?\s*(?:text|response|answer|reply|message|output|content)\s*>/gi;

export function stripLeakedTags(text) {
  const value = String(text ?? '');
  if (!value.includes('<')) return value;
  return value.replace(LEAKED_TAG_RE, '');
}

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

  const markers = [];
  const segments = [];
  /** 待注入到下一段开头的文字（行尾标记会贴回上一条，可跨行保留）。 */
  let prefix = '';

  const push = (value) => {
    const trimmed = value.trim();
    if (trimmed) segments.push(trimmed);
  };

  // 换行是硬分隔：一行一条（2026-11-18 定案，替换原来的 `【】` 教法）。
  // `【…】` 照旧解析，但提示词不再写它——只作为历史写法与桌宠气泡习惯的兜底。
  for (const line of text.split('\n')) {
    if (!line.trim()) continue; // 空行只当分隔，不产生空消息

    const pieces = [];
    let last = 0;
    MARKER_RE.lastIndex = 0;
    let m;
    while ((m = MARKER_RE.exec(line)) !== null) {
      const word = m[1].trim();
      // 空标记 `【】` 是纯分隔符；过长的当普通文本
      if (countChars(word) > MARKER_MAX) continue;
      if (m.index > last) pieces.push({ type: 'text', value: line.slice(last, m.index) });
      pieces.push({ type: 'marker', value: word });
      last = m.index + m[0].length;
    }
    if (last < line.length) pieces.push({ type: 'text', value: line.slice(last) });

    let current = '';
    for (const piece of pieces) {
      if (piece.type === 'text') {
        current += piece.value;
        continue;
      }
      // 标记：结束当前段，内容作为下一段的前缀
      push(`${prefix}${current}`);
      current = '';
      markers.push(piece.value);
      let injected = '';
      try {
        injected = String(resolveMarker(piece.value) ?? '');
      } catch {
        injected = '';
      }
      prefix = injected;
    }

    if (current.trim() !== '') {
      push(`${prefix}${current}`);
      prefix = '';
    } else if (prefix && segments.length > 0) {
      // 行尾标记：内容贴到前一条末尾，不单独成条
      const lastIndex = segments.length - 1;
      segments[lastIndex] = `${segments[lastIndex]}${prefix}`.trim();
      prefix = '';
    }
    // 整行只有标记且前面还没有内容时，prefix 留给下一行开头
  }
  if (prefix) push(prefix);

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

/**
 * 把认不出的 `[词]` 转成全角圆括号 `（词）`（2026-11-14 定案）。
 *
 * 背景：`[破涕为笑]` 这种微信自己会画成表情图，插件原样透传就行；
 * 但桌宠自编的 `[歪头看鱼]` 在微信里只会显示成方括号加文字，读起来像坏掉的表情。
 * 转成 `（歪头看鱼）` 就成了聊天里本来就有的「（摸摸头）」式旁白——
 * 不报错、不丢内容、也不打断她的写法习惯。
 *
 * `isWeChatEmoji(word)` 为真时原样保留；没闭合、含换行、含中英文括号的都不动。
 *
 * **它只是链路的后半段**：`world.js#toWeChatText()` 先 `applyAliases(outbound)`
 * 把内部名换成微信名，再调这里兜底。单跑本函数验证 `[笑哭了]` 得到的是
 * 「原样保留」，看着像别名没生效——那是只跑了一半，不是 bug（2026-11-14 演示翻车）。
 */
const BRACKET_RE = /\[([^[\]\\n（）()]{1,12})\]/g;

export function bracketToParen(text, isWeChatEmoji = () => false) {
  const value = String(text ?? '');
  if (!value.includes('[')) return value;
  return value.replace(BRACKET_RE, (whole, raw) => {
    const word = String(raw ?? '').trim();
    if (!word) return whole;
    let known = false;
    try {
      known = isWeChatEmoji(word) === true;
    } catch {
      known = false;
    }
    return known ? whole : `（${word}）`;
  });
}

/**
 * 把 `[桌宠的词]` 翻成 `[微信的表情名]`（如 `[开心]` → `[呲牙]`）。
 *
 * 存在的理由：桌宠的表达词表（`开心`/`生气`/`疑惑`）和微信的表情名（`呲牙`/`发怒`/`疑问`）
 * 是两套东西。她按老习惯写 `[开心]`，微信没有这个名字可画，只会显示方括号加文字。
 * 先翻译再兜底，这类词就落到正确的表情上，而不是变成旁白或垃圾字符。
 *
 * `resolveWeChat(word)` 返回空串表示这个词没有安全的微信对应，原样留给后面兜底。
 */
export function bracketToWeChat(text, resolveWeChat = () => '') {
  const value = String(text ?? '');
  if (!value.includes('[')) return value;
  return value.replace(BRACKET_RE, (whole, raw) => {
    const word = String(raw ?? '').trim();
    if (!word) return whole;
    let name = '';
    try {
      name = String(resolveWeChat(word) ?? '').trim();
    } catch {
      name = '';
    }
    return name ? `[${name}]` : whole;
  });
}

/** 句末标点：中文全角与英文半角都算。 */
const SENTENCE_END = /[。！？；…!?;\n]/;

/** 硬切时不要把 UTF-16 代理对拆成两半。 */
function safeCut(text, index) {
  if (index <= 0 || index >= text.length) return index;
  const code = text.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}

/**
 * 把一段长文本切成每段不超过 `limit` 的若干段。
 *
 * 切点优先级：段落（换行）→ 句子（句末标点）→ 硬切（不拆代理对）。
 * 微信单条文本上限 4000 字，超过会被服务端拒收，所以这一步必须做。
 */
export function splitLongText(text, limit) {
  const source = String(text ?? '');
  const max = Math.max(1, Math.floor(Number(limit) || 1));
  if (countChars(source) <= max) return [source];

  const parts = [];
  let rest = source;

  while (countChars(rest) > max) {
    // 按字符（而非码元）取窗口，保证不会先超限
    const window = [...rest].slice(0, max).join('');
    let cut = window.lastIndexOf('\n');
    if (cut < window.length * 0.5) {
      for (let i = window.length - 1; i >= 0; i -= 1) {
        if (SENTENCE_END.test(window[i])) {
          cut = i + 1;
          break;
        }
      }
    }
    if (cut < window.length * 0.3) cut = safeCut(rest, window.length);
    if (cut <= 0) cut = window.length; // 兜底：至少前进一段

    const piece = rest.slice(0, cut).trimEnd();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts.length > 0 ? parts : [source];
}

/**
 * 把段数收敛到最多 `maxSegments` 条。
 *
 * **只截断，不合并**：`【…】` 是作者/桌宠明确要求的分条语义，
 * 自动合并会把「第一句 / 第二句」又粘回一条，等于悄悄改了人家的排版。
 * 超出条数上限时只保留前 `maxSegments` 条，并如实报告丢了多少字。
 */
export function limitSegments(pieces, { maxSegments = 4 } = {}) {
  const max = Math.max(1, Math.floor(Number(maxSegments) || 1));
  const kept = [];
  for (const piece of pieces) {
    const value = String(piece ?? '').trim();
    if (value) kept.push(value);
  }
  if (kept.length <= max) return { segments: kept, dropped: 0 };
  const droppedText = kept.slice(max).join('');
  return { segments: kept.slice(0, max), dropped: countChars(droppedText) };
}
