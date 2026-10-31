# 气泡表情 → 微信表情 对应表

## 词表来源（权威）

Coopanion 的身体包 `figure.json` 里的 `vocab`，位于

```
<Coopanion>\resources\app\node_modules\cortico-world-desktop-pet\web\<figure>\figure.json
```

当前皮肤 `skin.figure = whale`，`web/whale/figure.json` 与 `web/coo/figure.json` 的 vocab **完全一致**
（各 37 条：19 个表情 + 18 个动作），所以本表与皮肤无关。

每条的结构：

```json
{ "id": "shy", "kind": "expression", "names": { "zh": ["害羞"] }, "about": {...}, "seconds": 0.9 }
```

`names` 是**按语言分的对象**，不是数组。模型写 `【害羞】` 或 `【shy】` 都能匹配
（`script.ts` 的解析规则：按 id 或任意 name 查找，找不到的词丢弃）。

## 已定的设计（2026-10-30）

1. `【X】` = 换气泡（分段），内容替换为对应 emoji；
2. emoji **贴到后面那段文字**；后面没文字就贴前面；连续标记合并成一条；
3. 多词标记（`【害羞,低头】`）按逗号/顿号拆开逐个映射，未命中丢弃；
4. **只映射 `expression`（表情）；`motion`（动作）一律只当分段符，不产生 emoji**；
5. `neutral`（平静）不发 emoji，只分段；
6. 未命中词 → 丢弃（微信里没有对应动作），回执里提示；
7. 实测观察：桌宠回复时基本只用**单个**表情标记（例如 `【nod】`），不会堆一串。

> 注：`【nod】` 属于 motion（点头），按第 4 条只作分段，不带 emoji。
> 若以后想给手势类开例外，在 `emojiOverrides` 里加几条即可，不改代码。

## 表情（expression，19 条）

| id | 中文 | emoji |
|---|---|---|
| neutral | 平静 | （不发） |
| happy | 开心/高兴 | 😄 |
| wink | 眨眼 | 😉 |
| love | 喜欢/爱心 | 😍 |
| shy | 害羞 | 😳 |
| surprised | 惊讶/吃惊 | 😲 |
| angry | 生气 | 😠 |
| sad | 难过/伤心 | 😢 |
| sleepy | 犯困/困 | 😪 |
| thinking | 思考/想想 | 🤔 |
| smug | 得意/嘚瑟 | 😏 |
| pout | 嘟嘴/哼 | 😗 |
| worried | 担心/着急 | 😟 |
| determined | 认真/坚定 | 😤 |
| flustered | 慌张/窘 | 😅 |
| scared | 害怕/吓到 | 😨 |
| excited | 期待/星星眼 | 🤩 |
| cry | 大哭/哭 | 😭 |
| confused | 疑惑/问号 | 😕 |

## 动作（motion，18 条）—— 不映射，仅作分段符

`stand` `jump` `hop` `look` `turn` `nod` `shake` `spin` `sit` `sleep`
`dizzy` `walk` `run` `wave` `bow` `shiver` `flap` `dance`

保留这份清单仅为排错用（看到 `【nod】` 时知道它是合法词、只是不出图）。

## 实现要点

- 文件：`plugin/src/emoji-map.js`，导出 `resolveEmoji(word)` 与 `EMOJI_MAP`；
- 查找顺序：**id（小写）→ zh 名 → en 名**；一张扁平表，键包含全部别名；
- 只登记 19 个 expression，motion 不登记（自然落到“找不到 → 丢弃”）；
- 长度计数用码点（`[...text].length`），否则 `😳` 会被算成 2 个字；
- 配置项（建议）：
  - `emojiReplace`（默认 `true`）：关掉后 `【…】` 只分段不替换；
  - `emojiOverrides`（对象）：用户覆盖或扩充，如 `{ "翻白眼": "🙄", "点头": "🙂" }`；
- 若某天微信不认 Unicode emoji（需实测），把 `emojiReplace` 关掉即可回退，不影响分段。

## 待实测

- [ ] 微信 bot 通道是否正常渲染 Unicode emoji（单发 `😳`、混排 `😳你别说了`）
- [ ] emoji 是否被计入 4000 字上限（按 UTF-16 计的话占 2 个单元）
