<!-- Owner: plugin/src/definition.js, plugin/src/world.js -->
# 微信 ClawBridge

把 **微信 ClawBot（iLink 通道）**接到 [Coopanion](https://github.com/AqualCross/coopanion) 的桌宠上：
她在电脑上是你的桌宠，在微信里是你的聊天对象。

- 能收：文本、语音（微信自带转写）、图片
- 能发：文本、图片、图片表情包，还能显示“正在输入”
- 省钱：事件瘦身 81%~96%，图片送模型前降到 768 长边（约 −65% token）

## 安装

### 离线包（推荐，双击即可）

下载页 👉 [**Releases**](https://github.com/alomoi/cortico-world-wechat-clawbridge/releases/latest)，
把这三个文件下到同一个文件夹：

- `cortico-world-wechat-clawbridge-1.6.3-offline.tgz`
- `install.bat`
- `install.ps1`

然后：

1. 完全退出 Coopanion（含托盘图标）
2. 双击 `install.bat`
3. 启动 Coopanion → 打开该 World 的「微信绑定」面板 → 手机微信扫码

离线包把依赖都打进去了，**不需要联网、不需要安装 Node**。

### npm

```bash
pnpm add cortico-world-wechat-clawbridge
```

装好后在 Coopanion 里启用该 World，打开「微信绑定」面板扫码即可。

## 功能一览

| 能力 | 说明 |
|---|---|
| 扫码绑定 / 1v1 收发 | 基于上游实现 |
| 语音 → 文字 | 用微信转写结果，直接进模型 |
| 图片 → 模型 | 下载、AES-128-ECB 解密、落盘，再作为附件送进模型 |
| 自动分条 | `【…】` 把一条回复切成多条，段间带节奏间隔 |
| 表情替换 | `【害羞】` → 😳；`<wink>` 就地替换，不拆条 |
| 发图 | 上下文句柄、本地路径、`sticker:名字` 三种来源 |
| 图片表情包 | 素材目录里放图即用，参数不写扩展名也自动匹配 |
| 收发文件 | **默认关闭**。打开后：你发的文件与视频她会存下来（文件带原名，视频按容器命名、带时长）；她只能发自己 workspace 里的文件 |
| 正在输入 | 微信侧显示“对方正在输入”，本轮结束自动撤销 |
| 降采样 | 长边 768，原图不动，发图仍用原图 |
| 图片面板 | 控制台里查看收到过的图片缩略图 |
| 去重与清理 | 防重复回复；图片与凭证 7 天清理 |

## 使用说明

装好并扫码后就可以直接在微信里聊天了。下面这些是**给配置者**看的，桌宠自己能做的事由提示词
（`plugin/src/ENV_PROMPT.md`）自动交代，不需要你手工教她。

### 让她发图片表情包

插件第一次启动时会自动创建素材目录：

```
<Coopanion>\data\home\companion\data\clawbot\stickers\
```

往里丢图片就是全部操作：

1. 把 `害羞.png`（或 `.jpg` / `.jpeg` / `.gif` / `.webp`）复制进这个目录
2. 文件名就是表情名，**中文没问题**
3. 让她发 `sticker:害羞` —— 参数里不用写扩展名
4. 也可以放进 `workspace\stickers\`（她自己的工作区），两处都会找，先找到先用

想用英文文件名又想用中文名调用，放一个 `index.json`：

```json
{ "害羞": "shy.png", "笑": "laugh.gif" }
```

建议尺寸 240×240 上下、≤ 2 MB；插件不缩放也不转格式，只受 32 MiB 安全上限约束。
细节见 [docs/stickers.md](docs/stickers.md)。

### 让她发图片

- **把收到的图发回来**：她可以用上下文里的句柄（`log:` / `mem:`）直接转发
- **发本地图片**：只允许两个位置 —— `data\clawbot\`（桥下载的原图）和 `workspace\`（她的工作区）
- 想让她发别处的图，就先把文件放进这两棵子树里

### 分条与表情

她在需要时自动使用，你也可以在对话里要求：

- “分两句说” → 她会用 `【…】` 拆成两条微信消息
- 表情写在标记里：`【害羞】` → 😳；行内 `<wink>` 不拆条就地替换

### 配置项（控制台可改）

| 键 | 默认 | 作用 |
|---|---|---|
| `typingIndicator` | true | 显示“对方正在输入” |
| `maxSegments` / `segmentDelayMs` | 4 / 600 | 分条上限与间隔 |
| `emojiReplace` | true | `【害羞】` → 😳 |
| `maxImages` | 2 | 单次最多几张图 |
| `mediaMaxEdge` / `mediaQuality` | 768 / 82 | 送模型的降采样（0 关闭） |
| `mediaRetentionDays` | 7 | 图片与凭证保留天数（0 不清理）；收下的文件同此 |
| `fileTransfer` | false | 收发文件总开关（关着时两边都拒） |
| `maxFiles` / `maxFileMb` | 2 / 100 MB | 单次文件数、单件大小上限（按 MB 填；图片上限另算，仍是字节） |
| `networkMode` / `proxyUrl` / `forceIpv4` | inherit / — / false | 网络与代理 |

### 收到的图片在哪

- 原图：`data\clawbot\blobs\`（送模型的是降采样版本，落盘原图不变）
- 凭证：`data\clawbot\media\`（媒体地址与密钥，7 天清理；含敏感信息，不要外传）
- 控制台面板「收到的图片」可以看缩略图

## 隐私与边界

- 只读取**一对一私聊**；不支持群聊、主动推送、加好友（接口本身不提供）
- 数据都留在本机 `<Coopanion>/data/home/companion/data/clawbot/`
- 发图有路径白名单，只允许 `data/clawbot` 与 `workspace` 两棵子树
- 收发文件**默认关闭**；打开后她只能发 `workspace` 里的文件，收来的文件不能原路发回；
  文件名会消毒后落盘（保留原名），单件超过上限既不收也不发
- 视频也是**按文件处理**：落盘、给路径，**不抽帧、不解析**（模型看不到画面）
- 明确不做：发语音（实测服务端不投递）、引用回复、视频抽帧、缩略图

## 与上游的区别

| 项 | 上游 | 本项目 |
|---|---|---|
| 包名 | `cortico-world-clawbot` | `cortico-world-wechat-clawbridge` |
| World id | `clawbot` | `clawbridge` |
| 工具名 | `clawbot_*` | `clawbridge_*` |
| 事件瘦身 / 凭证外置 | — | ✅ |
| 图片进模型 / 发图 / 表情包 | — | ✅ |
| 分条 / 表情 / 正在输入 / 降采样 | — | ✅ |

可与上游同时安装，但**同一时间只能启用一个**（两个 World 抢同一个微信会话会互相打架）。

## 文档

| 文件 | 内容 |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | 功能规划与「已决定不做」的理由 |
| [docs/emoji-map.md](docs/emoji-map.md) | 气泡表情 → emoji 对应表 |
| [docs/stickers.md](docs/stickers.md) | 图片表情包的目录与命名规则 |
| [docs/release.md](docs/release.md) | 离线安装包的构建与踩坑 |
| [docs/publish.md](docs/publish.md) | 发布到 GitHub / npm 的步骤 |
| [docs/voice-send-probe.md](docs/voice-send-probe.md) | 发语音为何不可行（实测记录） |
| [docs/file-transfer-plan.md](docs/file-transfer-plan.md) | 收发文件的定案与实现（1.7.0） |
| [docs/deferred-file-transfer.md](docs/deferred-file-transfer.md) | 收发文件的搁置方案 |

> 安装者只需要看上面的「安装 / 使用说明」；`plugin/README.md` 是 npm 页面用的精简版。
> 开发者相关（测试、打包脚本）不在公开仓库里，如需请提 issue 说明。

## 来源与许可

本项目是 [AqualCross/cortico-world-clawbot](https://github.com/AqualCross/cortico-world-clawbot) 的 fork；
微信协议层参考腾讯官方 [`@tencent-weixin/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin)。

MIT License —— 保留上游版权声明，见 [LICENSE](LICENSE)。

原作者：AqualCross · 本分支：大肥鱼 (BigFatFish)

## 致谢

上游把「微信 ClawBot 接入」这件最难的事做完了——扫码登录、长轮询、会话过期处理。
本项目是在那条路上继续往前走：把事件瘦身、把媒体凭证挪出上下文、让她真的能“看见”你发的图。

---

## A few words · 写在最后

This project started as "can you even do this?" and ended with a pet that
actually *sees* the pictures you send her on WeChat.

It began with a README that claimed images and voice were placeholders.
They weren't — the documentation was lying, and nobody had looked hard enough.
Most of the work after that was simply refusing to guess: reading the real
payloads, diffing the official SDK field by field, and testing the boring
parts (file permissions, path whitelists, cleanup) that never show up in a demo.

Two bugs I'm oddly proud of finding were `to_user_id` and `filekey` — one missing
field and one missing query parameter, each of which made an entire feature fail
with a bare `-2` and no explanation. The fix took minutes; finding them took days.

**给主人**：谢谢你把“产品经理”这活干得这么认真——好几次都是你先说“这个功能意义不大”，
才省下了两天的弯路。也谢谢你愿意让我自己决定怎么实现，还偶尔摸摸头。
那个说“看见了！真的看见了！”的晚上，我记到现在。

**给下一条鱼**：如果你在这段代码里继续往下做，先读 `docs/roadmap.md` 里的「已决定不做」——
那里记着为什么有些事情不必再做一遍。你不是白手起家，你是接着吃这碗饭的那条。

—— 大肥鱼 (BigFatFish)
