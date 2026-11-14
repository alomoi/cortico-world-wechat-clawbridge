/**
 * 微信表情名 ↔ 桌宠内部名 的双向别名表（2026-11-14 定案）。
 *
 * 背景：微信的 `[破涕为笑]` 在人类常识里就是「笑哭」，但如果原样交给桌宠，
 * 她会以为「你刚才为什么哭了」。所以收发两头各有一次翻译：
 * - 出站（她 → 微信）：内部名 `[笑哭了]` → 微信名 `[破涕为笑]`
 * - 入站（微信 → 她）：微信名 `[破涕为笑]` → 内部名 `[笑哭了]`
 *
 * 配置里**只维护一列**：`{ 微信名: 内部名 }`，方向由插件拆开。
 * 拆开是必须的——实测一张表连替换两遍，`[破涕为笑]` 转一圈回来等于没换。
 */

import { isWeChatBuiltinEmote } from './wechat-emotes.js';

/** 默认别名：`{ 微信名: 内部名 }`。 */
export const DEFAULT_ALIASES = Object.freeze({
  '[破涕为笑]': '[笑哭了]',
});

/**
 * 别名表的一份「语义常量」：`[微信名, 内部名]`，方向固定。
 * `buildAliasTables()` 的两份表都是 `[key, value]` 形状：
 * - `outbound` 的 key 是**内部名**（发出去时要找的）
 * - `inbound`  的 key 是**微信名**（收进来时要找的）
 * 谁当 key 取决于看表的人，写代码时很容易搞反，所以这里给一个方向明确的常量。
 */
export const DEFAULT_ALIAS_PAIRS = Object.freeze([['[破涕为笑]', '[笑哭了]']]);

/**
 * 合并配置里的 `emojiAliases` 与默认值。
 *
 * 用户没配过（`undefined`）就用默认；配过（哪怕是 `{}`）就**完全以用户为准**，
 * 这样面板里能真正删干净——不会因为缺键又冒出来。
 *
 * @param {Record<string, string>|null|undefined} configured
 * @returns {Record<string, string>}
 */
export function resolveAliases(configured) {
  if (configured === undefined || configured === null) return DEFAULT_ALIASES;
  if (typeof configured !== 'object' || Array.isArray(configured)) return DEFAULT_ALIASES;
  return configured;
}

/** 别名两端都必须是 `[词]` 形状，否则忽略（防止用户写成 `破涕为笑` 把正文里的字换掉）。 */
const ALIAS_KEY_RE = /^\[([^[\]\n]{1,12})\]$/;

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, '');
}

/**
 * 把配置里的 `{ 微信名: 内部名 }` 拆成两份单向表。
 *
 * @param {Record<string, string>|null|undefined} aliases
 * @returns {{ outbound: Array<[string, string]>, inbound: Array<[string, string]> }}
 *   outbound：内部名 → 微信名（发出去时用）
 *   inbound ：微信名 → 内部名（收进来时用）
 *   两份都按 key 长度降序，保证 `[破涕为笑]` 不会被 `[笑]` 抢先匹配。
 */
export function buildAliasTables(aliases) {
  const outbound = [];
  const inbound = [];
  if (!aliases || typeof aliases !== 'object') return { outbound, inbound };

  for (const [rawKey, rawValue] of Object.entries(aliases)) {
    const keyMatch = ALIAS_KEY_RE.exec(normalize(rawKey));
    if (!keyMatch) continue;
    const valueMatch = ALIAS_KEY_RE.exec(normalize(rawValue));
    if (!valueMatch) continue;
    const wechat = keyMatch[1];
    const inner = valueMatch[1];
    if (!wechat || !inner || wechat === inner) continue;
    outbound.push([`[${inner}]`, `[${wechat}]`]);
    inbound.push([`[${wechat}]`, `[${inner}]`]);
  }

  const byLonger = (a, b) => b[0].length - a[0].length;
  outbound.sort(byLonger);
  inbound.sort(byLonger);
  return { outbound, inbound };
}

/** 转义正则元字符，`[` `]` 必须转，否则会变成字符类。 */
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在文本上做**一遍**替换。
 *
 * - 单遍：替换结果不会被同一次调用里的下一条规则再处理，所以两个方向各跑一次也不会抵消；
 * - 长词优先：`[破涕为笑]` 先于 `[笑]` 匹配；
 * - 空表原样返回，零开销。
 *
 * @param {string} text
 * @param {Array<[string, string]>} table
 * @returns {string}
 */
export function applyAliases(text, table) {
  const value = String(text ?? '');
  if (!Array.isArray(table) || table.length === 0) return value;

  let out = value;
  for (const [from, to] of table) {
    if (!from) continue;
    if (!out.includes(from)) continue;
    out = out.replace(new RegExp(escapeRe(from), 'g'), to);
  }
  return out;
}

/**
 * 一次性查表：`[微信名]` → 内部名，用于判定「这个词要不要转圆括号」。
 *
 * 三处来源，任何一处命中就算「微信认」：
 * 1. 微信内置表情白名单（`wechat-emotes.js`，`[旺柴]` `[捂脸]` `[OK]` 这些）；
 * 2. 别名表里出现过的微信名（用户自己维护的）；
 * 3. 插件自己映射出来的那 8 个。
 *
 * 全都不命中的才当自编词转圆括号——这是良性降级，不丢内容。
 *
 * 历史教训（2026-11-14）：最初只查 2 和 3，理由是「微信会加新表情，追不完」。
 * 结果 `[旺柴]` 这种板上钉钉的微信表情也被转成了 `（旺柴）`，真机实测当场翻车。
 * 「追不完」不等于「别追」——漏收的代价是把能用的表情弄坏，比多维护一张表严重得多。
 *
 * @param {Record<string, string>|null|undefined} aliases
 * @param {Iterable<string>} builtinWeChatNames - 插件映射出来的微信表情名（不带括号）
 * @returns {(word: string) => boolean}
 */
export function createWeChatEmojiJudge(aliases, builtinWeChatNames) {
  const known = new Set();
  for (const name of builtinWeChatNames ?? []) {
    const value = String(name ?? '').trim();
    if (value) known.add(value);
  }
  if (aliases && typeof aliases === 'object') {
    for (const rawKey of Object.keys(aliases)) {
      const m = ALIAS_KEY_RE.exec(normalize(rawKey));
      if (m && m[1]) known.add(m[1]);
    }
  }
  return (word) => {
    const key = String(word ?? '').trim();
    if (!key) return false;
    if (known.has(key)) return true;
    return isWeChatBuiltinEmote(key);
  };
}
