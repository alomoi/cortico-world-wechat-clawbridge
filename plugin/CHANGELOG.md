# Changelog

## 1.6.3 · 图标

- 新增 `icon.png`（256×256，胖鱼 + 微信绿“正在输入”气泡），市场卡片有图了。
- `cortico.icon: "icon.png"`，并加入 `files`，两个发行包都包含。
- 生成脚本 `tools/make-icon.py`（Pillow，可复现地重画）。

## 1.6.2 · 市场卡片与安装者文档

- `cortico.locales`（zh/en）补上卡片用的显示名与一句话简介；包 `description` 改成面向使用者的说法。
- `plugin/README.md` 重写为「安装者手册」：绑定三步、**表情包图片怎么放**（目录、命名、格式、
  建议尺寸、`index.json` 别名、改素材不用重启）、发图白名单、配置项表、图片存放与清理位置。
- README 末尾加一段简短的致谢（上游与使用者）。
- 根 README 与 `plugin/README.md` 分工明确：前者是 GitHub 门面，后者是 npm/市场页面。

## 1.6.1 · 文档与提示词补全

- **提示词重写并瘦身**（`src/ENV_PROMPT.md`）：**1526 → 914 字符**（约 740 → 429 token，
  比桌宠本体提示词还短）。按“每轮都注入上下文”来取舍，只留必要信息：
  - **回执怎么读**：`[wx] 送达 …` / `他还没先说话` / `上下文已过期` / `服务无响应(-2)` /
    `表情「x」不在素材表` 的含义，并明确“失败时不要假装已发送”。
  - **贴纸与 emoji 的取舍**：不确定素材有没有就用 `【害羞】`，`sticker:` 不一定存在。
  - **防编造**：描述图片只讲确实看到的，看不清就说看不清。
  - 删掉重复解释与冗长示例，表情词表改单行罗列。
- **README 补使用说明**：表情包怎么放图（目录、命名、扩展名自动匹配、可选 `index.json`、
  建议尺寸）、怎么让她发图、分条与表情怎么写、配置项表、收到的图片在哪。
  `plugin/README.md`（npm 页面）同步补了精简版。
- 说明桌宠的行为由提示词自动交代，配置者不需要手工教她。

## 1.6.0 · 发行准备

- 元数据更新为独立仓库（`alomoi/cortico-world-wechat-clawbridge`），移除 `private`，保留 MIT。
- LICENSE 追加本分支版权声明，同时保留上游 AqualCross 的版权（MIT 要求）。
- README 重写：功能全表、两种安装方式、隐私说明、不做的功能、写给作者与下一条鱼的话。
- 新增 `.gitignore`。
- 新增离线发行产物：`dist/offline/` 里的 630 KB 包（依赖内置，`dependencies: {}`），
  配 `install.bat` / `install.ps1`，按 PowerShell 5.1 编写，双击即可安装。
- 新增 `plugin/tools/build-offline.mjs`（esbuild 打包脚本）。

## 1.5.1 · 修「正在输入」不收尾

- **修**：桌宠收到消息但**不回复**时，微信侧会一直显示「对方正在输入」。
  现在 World 实现 `onTurnEnded()`——本轮结束（assistant 自然结束 / LLM 失败 / 轮数上限）
  就撤掉输入状态，不再依赖「发出回复」这一个出口。
- **修**：取消时若没缓存 `typing_ticket`，会现取一次，避免取消请求因缺字段静默失败。
- 兜底时钟从 120 秒缩短到 **60 秒**（正常路径由上面两个出口取消，这只是最后防线）。
- `startTyping` 改为仅在驱动运行中生效（`running` 而非内部 stopped 标志，便于单测）。
- 新增 `tests/s10-typing-lifecycle.mjs`（11 项）：开始/重复调用/本轮结束取消/重复取消/未运行不打扰。

## 1.5.0 · 工程健康

- **入站去重**：`src/seen.js`，按 `message_id`（回落 `msg_id`）记最近 500 条，
  防止同步游标重放导致同一句话被回两次。
- **过期清理**：`src/cleanup.js`，启动时删除 `clawbot/blobs` 与 `clawbot/media` 里超过
  `mediaRetentionDays`（默认 7，0 关闭）的文件；只删普通文件、不递归、失败只记日志。
- **控制台面板**：新增「收到的图片」面板，按时间倒序展示缩略图（长边 200px，data URL）、
  时间、大小、尺寸；只读 `blobs/`，发送时仍用原图。新增 `src/media-list.js`。
- 配置页新增 `mediaRetentionDays`。
- 测试：S8（去重+清理 18 项）、S9（图片列表 9 项）。

## 1.4.1 · 降采样（真机验证通过）

- 送模型前把图片长边缩到 `mediaMaxEdge`（默认 768，0 关闭），JPEG `mediaQuality`（默认 82）。
  **只动送模型的那一份**，`clawbot/blobs/` 里的原图保持不变（桌宠仍可发回原图）。
- 下限保护：目标小于 544 时抬到 544（再小会被上游放大，省不到 token）。
- **像素降幅 < 10% 时不重编码**（1.4.1 补）：只比目标大一点的图，缩完文件反而会变大。
- 跳过：GIF（动图会丢帧）、本就不大的图、无法解码的坏数据；任何异常都原样返回。
- 实测：1919×1080（858 KB）→ 768×432（64.5 KB，−92% 字节，约 −65% 图片 token）。
- 新增 `src/resize.js`（依赖 `jimp`，纯 JS 无需编译）；20 项测试覆盖尺寸/比例/开关/下限/跳过/坏数据。
- 工具：`tools/preview-downscale.mjs`（生成前后对照，插件本身不落盘降采样结果）。

## 1.3.0 · 正在输入 + 图片表情包（真机验证通过）

- **正在输入**：收到消息后调 `sendtyping(status:1)`，每 4 秒续一次，回复发出时
  `status:2` 取消；`typing_ticket` 来自 `getconfig`（按用户缓存）。新增配置 `typingIndicator`(true)。
  失败静默，不影响主流程；最长 120 秒自动取消。
- **图片表情包**：`images: ["sticker:名字"]`。插件启动时自动创建
  `<dataDir>/clawbot/stickers/`，按「同名文件 → 可选 index.json 别名」的顺序查找，
  **参数里不写扩展名**（自动试 png/jpg/jpeg/gif/webp）；也搜 `workspace/stickers/`。
- 新增 `src/stickers.js`（`stickerNameOf` / `findSticker` / `listStickers`），11 项测试覆盖。
- 表情包本质是图片，复用既有的上传链路，没有额外协议字段；插件不缩放、不转格式，
  只受 `maxMediaBytes` 安全上限约束。用法与素材建议见 `docs/stickers.md`。
- 提示词与工具描述已写明 `sticker:` 用法。

## 1.2.5 · 发图打通（真机验证通过）

- **修**：`getUploadUrl` 补上官方必传的 `to_user_id`（缺了直接 `ret=-2`，且不带 errmsg）。
- **修**：服务端只返回 `upload_param` 时，回退拼接的上传地址漏了 `filekey`
  → CDN 返回 HTTP 400；现已按官方 `buildCdnUploadUrl` 补上。
- **清**：`image_item` 删掉官方没有的顶层 `aeskey` 字段。
- **诊断**：上传失败读 `x-error-message` 响应头与响应体；错误带 `stage`
  （`getuploadurl` / `upload` / `sendmessage`），回执显示成
  `上传地址失败(-2)` / `上传失败(400)` / `发送失败(-2)`。
- **诊断**：最近一次发图失败写入 `<dataDir>/clawbot/last-image-error.json`。
- **安全**：图片路径白名单只放 `<dataDir>/clawbot` 与 `<companion>/workspace` 两棵子树
  （`.env`、对话记录、配置一律拒绝），并抽成 `paths.js`（`isInsideAny`）单测覆盖。
- 真机验证：`log:` / `mem:` / workspace 路径三种来源发图全部成功。
- 依据：对照腾讯官方 `@tencent-weixin/openclaw-weixin@2.4.10` 源码逐字段核对。

## 1.2.0 · 发图（S4）

- `clawbridge_send` 新增 `images` 参数：文字发完后按顺序发图，支持
  - `log:…` 图片句柄（把对方刚发来的图发回去）；
  - 数据目录内的绝对路径（目录之外一律拒绝，防止被诱导发送任意文件）。
- 新增上传链路：`getUploadUrl` → AES-128-ECB 加密 → 上传密文取 `x-encrypted-param` → `sendImage`
  （`api.js` + `driver.js`，`media.js` 补 `encryptAesEcb` / `md5Hex` / `prepareMediaUpload`）。
- 回执支持构成说明：`[wx] 送达 09:25 2条(1文+1图) 12字`。
- 新增配置 `maxImages`(2)；`midSizeMode`(cipher/plain) 与 `imageRoots` 写在 config.json。
- 已知待验证：`mid_size` 该填明文还是密文长度（收侧实测为明文，发侧暂按密文）。

## 1.1.1 · 行内表情

- 新增行内标记 `<…>`（如 `<wink>`、`<害羞>`）：**就地替换成 emoji，不拆分消息**，
  与 Coopanion 的 `script.ts` 行内语义一致。
- 只识别身体包词汇（19 个表情 + 18 个动作）；未知内容（如 `<div>`、`a<b>c`）**原样保留**，
  不会误伤普通文本。
- `<nod>` 这类动作词会被直接移除（微信里没有对应表现）。
- 工具描述与 `ENV_PROMPT.md` 已补充 `<…>` 用法。

## 1.1.0 · 会话体验（S1–S3）

- **回执**：`clawbridge_send` 改为返回一行回执，不再抛异常。
  成功 `[wx] 送达 09:25 32字`（多条带条数），失败 `[wx] 失败:他还没先说话` /
  `[wx] 失败:上下文已过期` / `[wx] 失败:服务无响应(-2)`。
- **分段**：`【…】` 作为消息分隔符（`【】` 空标记同样有效），一条回复按顺序发成多条，
  段间默认 600ms（±30% 抖动）。新增配置 `maxSegments`(4) / `segmentDelayMs`(600)。
- **表情替换**：`【害羞】`/`【shy】` 换成 😳 等微信 emoji（19 个 expression）；
  动作词（`【nod】` 等）只当分段符，不产生内容。新增配置 `emojiReplace`(true)。
- 工具描述与 `ENV_PROMPT.md` 已写明上述语法；`describe.json` 重新生成。

## 1.0.0 · 正式版

首个正式发布。在 0.2.0 基础上完成图片送入模型与配置收口，真机验证通过。

- **图片送入模型**：`imageBlobsFor()` 把落盘图片整理成 `BlobInput`，
  `pushEvent({ blobs })` 附加；`mediaAttach` 默认开启，模型 `accepts(mime)` 为假时自动降级为仅给路径。
  实测：DeepSeek 在 tool 角色事件中正常收到图片并描述内容。
- **配置收口**：`mediaAttach` / `mediaDownload` / `maxMediaBytes` 三项进入控制台配置页。
- **提示词**：补全 `ENV_PROMPT.md`，说明语音已转写、图片会以路径与附件出现、控制台不显示缩略图属正常。
- **署名**：作者改为大肥鱼 (BigFatFish)，上游 AqualCross 记入 contributors。
- 修复：`modelFacts.accepts()` 抛错时不再阻断投递（改为按“支持”处理）。

## 0.2.0 · ClawBridge 分支

基于上游 `cortico-world-clawbot@0.1.0` 分叉，World id 改为 `clawbridge`，可与原版并存安装。

- **事件瘦身**：`meta.raw` 从完整原始包改为白名单信封（`seq/msgId/at/from/items`）。
  媒体事件体积约 -94%，文本事件约 -81%。
- **媒体凭证外置**：`full_url` / `encrypt_query_param` / `aes_key` / `aeskey`
  不再进入事件与模型上下文，改为落 `<dataDir>/clawbot/media/<key>.json`（原子写 + 0600）。
- **图片接收**：入站图片按 `full_url` 下载、AES-128-ECB 解密、按魔数识别格式、
  落 `<dataDir>/clawbot/blobs/`；事件正文变成 `[图片 <本地路径>]`。
  下载失败只记日志并降级为 `[图片]`，不阻塞消息。
- **工具**：`clawbridge_send` / `clawbridge_status` / `clawbridge_events`；
  `clawbridge_events` 默认 `raw: false`、默认返回 10 条。
- **复用绑定**：数据目录仍为 `clawbot/`，安装后无需重新扫码。
- 新增高级配置 `mediaDownload`（默认 true）与 `maxMediaBytes`（默认 32 MiB）。
- 语音沿用微信转写文本（`voice_item.text`），不下载音频。

## 0.1.0 · 上游基线

- 通过微信 ClawBot（iLink）做 1v1 文本收发：扫码绑定、长轮询收消息、`clawbot_send` 回复。
- 连接状态和「重新连接」在控制台面板与 `clawbot_status` 里；连接、断开和会话过期不投递事件。
- 网络出口可选 `inherit` / `direct` / `proxy`，可强制 IPv4；二维码请求失败会重试，扫码状态断线后继续轮询。
- 凭据、游标和 `context_token` 存在 `<dataDir>/clawbot/`；图片、语音、文件、视频只显示占位。
- 仅 1v1 且只能回复；不支持群聊、主动加好友或读取其他微信会话。
- 提示词页默认空模板，标题为「提示词」。
