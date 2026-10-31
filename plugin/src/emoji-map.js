/**
 * Coopanion 气泡表情 → 微信 emoji 的对应表。
 *
 * 词表来自身体包的 `figure.json`（`web/<figure>/figure.json` 的 `vocab`），
 * whale 与 coo 两个包完全一致：19 个 expression + 18 个 motion。
 *
 * 设计（见 docs/emoji-map.md）：
 * - **只映射 expression（表情）**；motion（动作）不登记，解析为空串，只当分段符；
 * - `neutral`（平静）也是空串——默认脸硬塞 emoji 反而怪；
 * - 别名收录 id / 中文名 / 英文名，查表时先精确匹配再小写匹配；
 * - 支持外部 overrides（配置项 `emojiOverrides`）覆盖或扩充。
 */

/** [id, 中文名, emoji] —— 只有这 19 个表情会被替换。 */
const ENTRIES = [
  ['neutral', ['平静'], ''],
  ['happy', ['开心', '高兴'], '😄'],
  ['wink', ['眨眼'], '😉'],
  ['love', ['喜欢', '爱心'], '😍'],
  ['shy', ['害羞'], '😳'],
  ['surprised', ['惊讶', '吃惊'], '😲'],
  ['angry', ['生气'], '😠'],
  ['sad', ['难过', '伤心'], '😢'],
  ['sleepy', ['犯困', '困'], '😪'],
  ['thinking', ['思考', '想想'], '🤔'],
  ['smug', ['得意', '嘚瑟'], '😏'],
  ['pout', ['嘟嘴', '哼'], '😗'],
  ['worried', ['担心', '着急'], '😟'],
  ['determined', ['认真', '坚定'], '😤'],
  ['flustered', ['慌张', '窘'], '😅'],
  ['scared', ['害怕', '吓到'], '😨'],
  ['excited', ['期待', '星星眼'], '🤩'],
  ['cry', ['大哭', '哭'], '😭'],
  ['confused', ['疑惑', '问号'], '😕'],
];

/** 扁平表：id / 中文名 → emoji。 */
export const EMOJI_MAP = Object.freeze(
  ENTRIES.reduce((acc, [id, names, emoji]) => {
    acc[id] = emoji;
    for (const name of names) acc[name] = emoji;
    return acc;
  }, {}),
);

/** 被识别为 expression 的词（排错用）。 */
export const EXPRESSION_WORDS = Object.freeze(ENTRIES.flatMap(([id, names]) => [id, ...names]));

/** 动作词：在微信里没有对应表现，解析为空串（只当分段符）。 */
const MOTIONS = [
  ['stand', ['站起', '站']],
  ['jump', ['跳', '跳起来']],
  ['hop', ['小跳', '蹦']],
  ['look', ['张望', '看看']],
  ['turn', ['转身']],
  ['nod', ['点头']],
  ['shake', ['摇头']],
  ['spin', ['转圈']],
  ['sit', ['坐下', '坐']],
  ['sleep', ['睡觉', '睡']],
  ['dizzy', ['晕', '转晕']],
  ['walk', ['走走', '散步']],
  ['run', ['跑', '跑起来']],
  ['wave', ['招手', '打招呼']],
  ['bow', ['鞠躬']],
  ['shiver', ['发抖', '哆嗦']],
  ['flap', ['扑腾', '激动']],
  ['dance', ['跳舞', '摇摆']],
];

/** 动作词的完整清单（id + 中文名）。 */
export const MOTION_WORDS = Object.freeze(
  new Set(MOTIONS.flatMap(([id, names]) => [id, ...names])),
);

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * 把一个标记词解析成 emoji。
 *
 * @param {string} word - 标记内容，如 `shy` / `害羞` / `nod`
 * @param {Record<string, string>|null} [overrides] - 用户覆盖：`{ "翻白眼": "🙄" }`
 * @returns {string} emoji；`''` 表示“不产生表情”（动作、平静、未知词）
 */
export function resolveEmoji(word, overrides = null) {
  const key = String(word ?? '').trim();
  if (!key) return '';

  if (overrides && typeof overrides === 'object') {
    if (hasOwn(overrides, key)) return String(overrides[key] ?? '');
    const lower = key.toLowerCase();
    if (hasOwn(overrides, lower)) return String(overrides[lower] ?? '');
  }

  if (hasOwn(EMOJI_MAP, key)) return EMOJI_MAP[key];
  const lower = key.toLowerCase();
  if (hasOwn(EMOJI_MAP, lower)) return EMOJI_MAP[lower];
  return '';
}

/**
 * 是否是已知的身体包词汇（表情或动作）。
 *
 * 行内标记 `<…>` 只替换已知词，避免把 `<div>`、`a<b` 这类普通文本吃掉。
 */
export function isKnownWord(word) {
  const key = String(word ?? '').trim();
  if (!key) return false;
  const lower = key.toLowerCase();
  return (
    hasOwn(EMOJI_MAP, key) || hasOwn(EMOJI_MAP, lower)
    || MOTION_WORDS.has(key) || MOTION_WORDS.has(lower)
  );
}
