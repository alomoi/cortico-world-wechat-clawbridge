# ClawBridge 后续功能路线图

> 原则：**一次只做一项**，每项自带验收；真机验证尽量合并到同一批，减少重启次数。
> 每批完成 → 打包 → 装进 Coopanion → 你测一轮 → 有问题当批回滚。
> 版本号：一批一个次版本（1.1.0 / 1.2.0 / …）。

---

## 总览

| 批次 | 内容 | 依赖 | 预计 | 交付形态 |
|---|---|---|---|---|
| **第 1 批 · 1.1.0** | 回执 ✅ + 文本分段 ✅ + 表情替换 ✅ | 无 | 1 天 | 纯文本，立即可用 |
| **第 2 批 · 1.2.0** | 发图核心（路径 / `log:` 句柄）✅ 真机验证通过（1.2.5） | 无 | 1 天 | 能发图 |
| **第 3 批 · 1.3.0** | 图片表情包（`sticker:`）+ 输入中状态 ✅ 真机验证通过 | 第 2 批 | 半天 | 能发表情包 |
| **第 4 批 · 1.4.0** | 输入中状态 ✅ / 引用回复 ❌ 不做 | 无 | 1 天 | 更像真人 |
| **第 5 批 · 1.5.0** | 降采样 ✅ / 文件·视频·缩略图 ❌ 不做 | 无 | 1.5 天 | 覆盖更全、更省 |
| **第 6 批 · 1.5.0** | 工程健康（去重 ✅ / 清理 ✅ / 面板 ✅ / 文档） | 前面若干 | 1 天 | 长期可维护 |
| 发行 | 依赖内置 + `install.ps1` + 上架准备 | 功能冻结 | 1 天 | 能装到别人机器 |
| **第 7 批 · 1.7.0** | 收发文件 ✅（默认关闭 / 只发工作区） | 无 | 1 天 | 能收藏文件 |
| 观察项 | 多账号、流式占位、工具进度提示 | — | — | 未验证，暂不做 |

> **已决定不做的（2026-10-31 定案）**：
> - **发语音**：**实测不可行**。`media_type=4` 上传通过、`sendmessage` 返回 `message_id`，
>   但微信端不显示任何内容（SILK 与 PCM 两种编码都试过，普通文字同路径可达）。
>   证据与请求结构见 [voice-send-probe.md](./voice-send-probe.md)，
>   重试工具 `tools/voice-send-probe.mjs`。
> - **引用回复**：一对一里引用是噪音，且协议字段未验证，收益不抵风险。
> - ~~**收发文件**~~：**2026-11-09 已做（1.7.0）**——场景真的出现了：桌宠想收藏一份文件。
>   定案与实现见 [file-transfer-plan.md](./file-transfer-plan.md)；默认关闭，发文件只允许工作区。
>   原搁置记录留在 [deferred-file-transfer.md](./deferred-file-transfer.md)。
> - **视频接收**：模型不看视频，抽首帧要引入 ffmpeg（70MB+），收益不值。
> - **缩略图（thumb_media）**：已有原图 + 降采样，收益边际。

---

## 第 1 批 · 1.1.0（会话体验）

### S1 · 回执格式（2 小时）✅ 已完成

> 已落地：`plugin/src/receipt.js`（`sentReceipt` / `failedReceipt` / `describeSendError` / `countChars` / `clockOf`），
> `world.js#toolSend` 改为返回回执而非抛异常；`tests/s1-receipt-check.mjs` 17 项全过。
> 实际格式：`[wx] 送达 09:25 32字`、`[wx] 失败:服务无响应(-2)`。

- **改动**：`world.js` 的 `#toolSend`，抽出 `receipt()` 辅助函数。
- **格式**：
  - 成功 `[wx] 送达 09:25 32字`
  - 失败 `[wx] 失败:他还没先说话` / `[wx] 失败:上下文已过期` / `[wx] 失败:服务无响应(-2)`
- **要点**：失败改为 `{ text, failed: true }`，不抛异常；`ILinkError` 的 `ret`/`status` 映射成括号里的数字。
- **验收**：四种失败路径各触发一次，格式与约定一致。

### S2 · 文本分段（3 小时）✅ 已完成

> 已落地：`plugin/src/segments.js`（`splitScript`），支持空标记 `【】` 作纯分隔符、
> 行尾标记贴前一条、超上限合并；`maxSegments`(4) / `segmentDelayMs`(600，±30% 抖动) 进配置页；
> 工具描述与 `ENV_PROMPT.md` 已写明语法；`tests/s2-segments-check.mjs` 20 项全过。

- **改动**：新增 `src/segments.js`（纯函数，便于测试）；`world.js` 调用；`config.js` 加两项。
- **规则**：`【…】` 切段；空段丢弃；连续标记合并；单次最多 `maxSegments`（默认 4）段；段间 `segmentDelayMs`（默认 400–900ms 随机）。
- **回执**：`[wx] 送达 09:25 3条 42字`。
- **验收**：三段文本 → 微信收到三条、顺序正确、间隔可见；超过上限时截断并在回执里说明。

### S3 · 表情替换（3 小时）✅ 已完成

> 已落地：`plugin/src/emoji-map.js`（`resolveEmoji` / `EMOJI_MAP`），19 个 expression 全覆盖、
> 动作不登记、支持 `emojiOverrides`；`world.js#markerResolver()` 接进 `splitScript`；
> `emojiReplace` 进配置页；`tests/s3-emoji-check.mjs` 24 项全过。

- **改动**：新增 `src/emoji-map.js`（见 [emoji-map.md](./emoji-map.md)）；集成进 `segments.js`。
- **规则**：19 个 expression → emoji；motion 只切段；`neutral` 不加；未命中丢弃。
- **配置**：`emojiReplace`（默认 true）、`emojiOverrides`（对象）。
- **验收**：`【shy】你别说了【happy】好啦` → 两条消息 `😳你别说了` / `😄好啦`。
- **⚠️ 真机关键点**：确认微信渲染 Unicode emoji（单发 `😳`、混排各测一条）。若不渲染 → 关 `emojiReplace` 回退。

> 第 1 批一次重启即可同时验 S1/S2/S3。

---

## 第 2 批 · 1.2.0（发图）

### S4 · 发图核心（1 天）

- **改动**：`api.js` 加 `getUploadUrl()` / `uploadMedia()` / `sendImage()`；`world.js` 加图片参数。
- **流程**：读字节 → size + MD5 → 生成 filekey 与 16 字节 AES key → `getuploadurl(media_type:1, no_need_thumb:true)` → AES-128-ECB+PKCS#7 加密 → POST 密文 → 取响应头 `x-encrypted-param` → `sendmessage` 带 `image_item`。
- **参数形态**：`images: string[]`，每项支持
  - 本地绝对路径
  - `log:<handle>`（上下文里的图，走 `host.blob()`）
- **待实测**：`mid_size` 语义（收图实测是**明文**大小；发送侧按官方代码写，两种都试）。
- **验收**：发一张本地 jpg → 微信收到；再把用户刚发的图用 `log:` 回发一次成功。
- **回执**：`[wx] 送达 09:25 2条(1文+1图) 12字`。

### S5 · 图片表情包（半天，依赖 S4）

- **改动**：`assets/stickers/`（`index.json` + 图片）；`send` 支持 `sticker:<名字>` 与 `【图:名字】` 标记。
- **设计**：素材表 = 文件名映射，支持你自己丢 GIF/PNG 进去扩充。
- **验收**：`sticker:shy` → 微信收到对应图片；名字不存在 → 回执 `失败:表情「xx」不在素材表`。
- **预期管理**：微信里显示为**普通图片**，不是原生贴纸。

---

## 第 3 批 · 1.4.0（更像真人）

### S6 · 输入中状态（半天）

- **改动**：`api.js` 加 `getConfig()`（取 `typing_ticket`）与 `sendTyping(status:1/2)`；入站消息到达时开启，发送完成后关闭。
- **验收**：微信端显示“对方正在输入…”。
- **风险**：ticket 有效期与刷新策略需实测。

### S7 · 引用回复（半天）

- **改动**：发送侧支持 `ref_msg`；接收侧解析入站 `ref_msg` 并附到事件文本。
- **验收**：微信里看到引用框；对方引用消息时我们能读到被引用的原文。
- **风险**：`ref_msg` 字段格式未验证（协议里有 `svr_id` / `partial_text`）。

---

## 第 4 批 · 1.5.0（接收扩展 + 省 token）

### S8 · 文件 / 视频 / 缩略图（1 天）

- **改动**：`media.js` 类型分支；文件落盘 + 事件里给路径；图片可优先取 `thumb_media` 做快速预览。
- **验收**：发一个 PDF → 落盘 + 事件带路径；发视频 → 有文件但默认不喂模型。
- **风险**：大文件占磁盘，需配合 S10 清理。

### S9 · 降采样（半天）

- **改动**：`media.js` 加 `resizeForModel()`，长边 ≤ `mediaMaxEdge`（默认 768）。
- **依赖**：`jimp`（纯 JS）或 `sharp`（原生）。
- **验收**：送模型的图长边 ≤768；对比 token 用量下降 50%+。
- **备注**：**不做 caption**（已否决，见 [clawbot-plan.md](./clawbot-plan.md)）。

---

## 第 5 批 · 1.6.0（工程健康）

| 项 | 内容 | 验收 |
|---|---|---|
| S10a 过期清理 | `blobs/`、`media/` 按天数清理（默认 7 天） | 启动时不报错，旧文件被删 |
| S10b 去重 | `driver.js` 加 seen 集合（按 `message_id`），防重放 | 重复投递不再触发两次回复 |
| S10c 控制台面板 | 列出收到的/发出的图片缩略图 | 面板能看到图 |
| S10d 文档与提示词 | README / ENV_PROMPT 更新（分段、表情、发图用法） | 桌宠不再误用旧行为 |

---

## 观察项（未验证，单独立项）

| 能力 | 说明 | 现状 |
|---|---|---|
| 多账号 | 官方支持一个网关挂多个微信号 | 我们只支持单账号 |
| `message_state` + `run_id` | 可能支持“先发占位再更新”的流式效果 | 未验证，纯猜测 |
| `tool_call_start/result`（11/12） | 可能在微信里显示“正在查资料…” | 未验证 |
| 群聊 | 微信 ClawBot 本身只支持 1v1 | 不可做 |

---

## 每批的固定动作

1. 改 `plugin/` 源码 → 本地跑 `tests/`（新增项补测试）
2. 升版本号（`package.json`）+ 更新 `CHANGELOG.md`
3. `node tools/describe.mjs` 重新生成 `describe.json`（改了工具声明时）
4. `pnpm pack` 出 tgz → 装进 Coopanion（`--store-dir` 别忘了）
5. 真机验证 → 结果回报 → 归档 `docs/` 记录

## 已知踩坑（别再踩）

- 装包必须带 `--store-dir`（Coopanion 自带 store）
- tarball 文件名不能与插件目录名相同（否则 pnpm 解析成目录 link）
- `mid_size` 收侧实测为**明文**大小
- 事件落在 tool 角色，但 DeepSeek 实测接受其中的图片分片
