# 实现计划：收发文件（1.7.0）

> 状态：**已实现**（2026-11-09）。原搁置方案见 [deferred-file-transfer.md](./deferred-file-transfer.md)。
> 场景：**小肥鱼想收藏一份文件**——主人发给她，她自己收下来；读不读由她自己/宿主决定，插件不管。
>
> **与最初计划的偏差**（按主人定案）：不新增 `fileRetentionDays`、不新开 `files/` 目录——
> 收下的文件就落 `clawbot/blobs`，跟图片一起按 `mediaRetentionDays`（默认 7 天）清理；
> 真要长期收藏，她自己复制进 workspace。

---

## 一、定案（主人拍板）

| 项 | 决定 | 理由 |
|---|---|---|
| 开关 | `fileTransfer`，**默认 false**，收/发都先看它 | 默认关着最安全；用户自行启用 |
| 发文件白名单 | **只有 `<companion>/workspace` 一棵子树** | 比图片更严：图片还能发 `clawbot/blobs`，文件只能发自己的工作区 |
| 能回发收来的文件吗 | **不能** | 同上；真要回发就先复制进 workspace |
| 保留天数 | **不新增配置，跟着 `mediaRetentionDays` 走**（默认 7 天） | 收来是临时文件；真要长期收藏她会自己复制进 workspace |
| 落盘目录 | 就用现有的 `clawbot/blobs/` | 清理逻辑现成覆盖，不新增目录 |
| 读不读内容 | **不读，不喂模型** | 只给路径 + 文件名 + 大小；省 token，守边界 |
| 视频 | **按文件处理**（同一开关、同一上限、落同一 `blobs`） | 模型没有视频阅读能力；存/读由模型决定，**不抽帧** |

## 二·附 视频的落盘细节

- 命名：`<时间戳>-wx-video.<ext>`，`ext` 由容器头判断（`ftyp`→`.mp4`、EBML→`.webm`、
  `RIFF….AVI `→`.avi`、`FLV`→`.flv`），认不出退化成 `.bin`。
- 正文：`[视频 5.0 秒 12.3 MB …/blobs/…-wx-video.mp4]`；开关关着时
  `[视频 5.0 秒 未下载(收发文件未开启)]`；超限、下载失败各有各的说法。
- **不拿 `video_size` 当门槛**：该字段语义未实测（和 `mid_size` 一样的陷阱区），
  上限一律由实际下载字节把关；测试里用 1 TB 假值验证过仍会正常下载。
- 不给 `bytes` 字段：视频绝不作为附件进模型上下文。

## 二、协议字段（已核对官方 `openclaw-weixin@2.4.10` 源码）

发文件 = `media_type: 3`（FILE）+ 一条 `type: 4` 的 item：

```js
file_item = {
  media: { encrypt_query_param, aes_key: base64(hexAesKey), encrypt_type: 1 },
  file_name: basename,
  len: String(plaintextSize),      // ← 明文字节数
}
```

**易错点**：图片的 `mid_size` 官方传的是**密文**长度，文件的 `len` 传的是**明文**长度。
这两个长得很像，抄错的表现是「收到坏文件」或静默失败。

## 三、改动清单

| 文件 | 改什么 |
|---|---|
| `plugin/src/config.js` | `DEFAULTS` 加 `fileTransfer:false` / `maxFiles:2` / `maxFileBytes:100MiB`；ZH/EN 文案；schema 三个字段 |
| `plugin/src/api.js` | 新增 `sendFile()`（照官方 `sendFileMessageWeixin`） |
| `plugin/src/driver.js` | 新增 `sendFile()`：复用上传管道，只换 `media_type: 3` + `no_need_thumb: true` |
| `plugin/src/files.js`（新） | 纯函数：`sanitizeFileName` / `namedBlobName` / `formatBytes` |
| `plugin/src/media-ref.js` | `captureMediaItems` 加 `kind==='file'` 分支（开关开才下载、按 `len` 先判超限）；`mediaRefOf` 给 file 记 `size` |
| `plugin/src/render.js` | 文件落盘后正文 `[文件 名 2.3 MB …/blobs/…]`；没开维持 `[文件 名]` |
| `plugin/src/world.js` | `#fileRoots()`（仅 workspace）、`files` 参数解析与拒绝、回执加「文件」计数、capture 传新开关与上限 |
| `plugin/src/ENV_PROMPT.md` | 「文件/视频只有占位」改写；写明默认关闭、只能发工作区、收来的在 blobs 且会过期 |
| `plugin/describe.json` | 改了工具声明，需 `node tools/describe.mjs` 重新生成 |
| `plugin/package.json` / `CHANGELOG.md` | 版本 1.7.0 |
| `README.md` | 功能表、配置项、隐私边界（现在写着「明确不做：收发文件」） |
| `docs/roadmap.md` / `milestones.md` | 收发文件从「不做」移出；新增 M9 |
| `tests/` | 4 个新文件（见下） |

## 四、安全闸门（必须都测到）

1. **总开关关闭时不落盘、不给路径**：入站文件维持 `[文件 名字]` 占位；`files` 参数回 `失败:文件收发未开启`。
2. **发文件路径白名单**：只认 `workspace` 子树；`blobs`、数据目录、`imageRoots`、机器上任意路径一律拒绝。
3. **文件名消毒**（收文件时对方给的 `file_name` 是外部输入）：
   - 只取 `basename`，绝不做路径拼接；
   - 剔除控制字符与 `<>:"/\|?*`；
   - 防 Windows 保留名（`CON` / `PRN` / `AUX` / `NUL` / `COM1-9` / `LPT1-9`）；
   - 去掉首尾点与空格，长度截到 100；空名退化成 `file`；
   - 加时间戳前缀防重名，重名再加 `-1`、`-2`。
4. **体积**：先用事件里的 `len` 判，超 `maxFileBytes` 不下载，正文只给文件名与「超出上限」。
5. **空文件**不发。

## 五、新增测试（4 个）

| 文件 | 覆盖 |
|---|---|
| `tests/s15-file-toggle.mjs` | 默认关闭；关闭时收/发都被拦；开启后放行 |
| `tests/s16-file-paths.mjs` | 只能发 workspace；越界/`blobs`/外部路径被拒；文件名消毒各种恶意形状 |
| `tests/s17-file-inbound.mjs` | 假 fetch 收文件 → 落 blobs、名字消毒、超限不下载、开关关不下载、正文格式 |
| `tests/s18-file-send.mjs` | 上传 payload（`media_type: 3`、`no_need_thumb`）与 item 字段（`type: 4`、`len` 是明文字符串） |

## 六、验收（真机）

1. 开关**关**：主人发一个文件 → 她只看到「[文件 名字]」，没有路径；她发文件 → 被拒。
2. 开关**开**：主人发一个 txt → 她收到带路径与大小的事件，blobs 里出现该文件；她说「收藏它」并把文件复制到 workspace。
3. 开关**开**：她发 workspace 里的一个 pdf → 微信收到文件卡片、能点开下载。
4. 越界尝试（`workspace` 外路径、`../` 文件名）全部被拒或落成安全文件名。

## 七、顺序

0. **探针** `tools/file-probe.mjs`：确认微信端能显示文件卡片（唯一未知项）
1. 发文件（config → api → driver → world → 回执 → 测试）
2. 收文件（files.js → media-ref → render → world → 测试）
3. 文档 / describe / 1.7.0 / 打包
4. 真机验收（上面的第 1–4 条）
