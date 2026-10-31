<!-- Owner: src/definition.js, src/world.js -->
# 微信 ClawBridge · cortico-world-wechat-clawbridge

把微信 ClawBot（iLink 通道）接到 Coopanion 的桌宠上：她在电脑上是你的桌宠，在微信里是你的聊天对象。

> 完整文档与源码：https://github.com/alomoi/cortico-world-wechat-clawbridge
> 本项目是 [AqualCross/cortico-world-clawbot](https://github.com/AqualCross/cortico-world-clawbot) 的 fork，
> 微信协议层参考腾讯官方 `@tencent-weixin/openclaw-weixin`。MIT License。

## 功能

| 能力 | 说明 |
|---|---|
| 扫码绑定 / 1v1 收发 | 继承上游 |
| 语音 → 文字 | 用微信自带转写，直接进模型 |
| 图片 → 模型 | 下载、解密、落盘，再作为附件送进模型 |
| 自动分条 | `【…】` 把一条回复切成多条，带节奏间隔 |
| 表情替换 | `【害羞】` → 😳；`<wink>` 就地替换不拆条 |
| 发图 | 上下文句柄、本地路径、`sticker:` 表情包 |
| 图片表情包 | 素材目录丢图即用，参数不写扩展名也匹配 |
| 正在输入 | 微信侧显示“对方正在输入”，本轮结束自动撤销 |
| 降采样 | 送模型前长边缩到 768（约 −65% 图片 token），原图不动 |
| 图片面板 | 控制台查看收到过的图片缩略图 |
| 去重与清理 | 防重复回复；图片与凭证 7 天清理 |

## 安装

```bash
pnpm add cortico-world-wechat-clawbridge
```

不方便联网的机器，可以在仓库 Releases 下载 `*-offline.tgz`，
配合同目录的 `install.bat` 双击安装（依赖已内置，不用联网）。

## 三步开始用

### 1. 绑定微信

Coopanion → 切到这个 World → 打开「**微信绑定**」面板 → 点扫码 → 用手机微信扫。

扫完面板会显示已绑定的微信昵称。之后在微信里给她发条消息试试。
**注意**：她只能回复"最近给你发消息的人"，不能主动推送。

### 2. 放表情包图片（最常被问）

插件第一次启动时会自动创建素材目录，不需要你手动建：

```
<Coopanion>\data\home\companion\data\clawbot\stickers\
```

默认路径示例：
`C:\Users\<你>\AppData\Local\Programs\Coopanion\data\home\companion\data\clawbot\stickers\`

操作：

1. 把图片复制进去，例如 `害羞.png`
2. **文件名就是表情名**，中文没问题（`开心.gif`、`无语.jpg` 都行）
3. 支持 `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`
4. 建议 240×240 上下、≤ 2 MB（插件不缩放、不转格式，太大的图发出去慢）
5. 想让桌宠用它：她会自己判断什么时候发，你也可以在对话里要求"发个害羞的表情"

也支持 `workspace\stickers\`（她自己的工作区），两处都会找，先找到先用。

**想用英文文件名、中文调用**：同目录放 `index.json`：

```json
{ "害羞": "shy.png", "开心": "laugh.gif" }
```

改了素材**不用重启**，下次用到就生效。

### 3. 让她发图

只允许两个位置，其他路径会被拒绝（安全白名单）：

| 位置 | 用途 |
|---|---|
| `<Coopanion>\data\home\companion\data\clawbot\` | 插件自己下载的原图 |
| `<Coopanion>\data\home\companion\workspace\` | 她的工作区，你往里放图让她发 |

把图片放进 `workspace\` 里，然后跟她说"把 workspace 里那张图发给我"即可。
她自己收到的图，可以直接让她"把刚才那张发回来"。

## 其它人工操作

### 改配置

控制台 → 该 World 的配置页，常用项：

| 键 | 默认 | 作用 |
|---|---|---|
| `typingIndicator` | true | 显示"对方正在输入" |
| `maxSegments` / `segmentDelayMs` | 4 / 600 | 分条上限与间隔 |
| `maxImages` | 2 | 单次最多几张图 |
| `mediaMaxEdge` / `mediaQuality` | 768 / 82 | 送模型的降采样（`0` 关闭） |
| `mediaRetentionDays` | 7 | 图片与凭证保留天数（`0` 不清理） |
| `networkMode` / `proxyUrl` | inherit / — | 走系统代理或手动指定 |

### 看收到过的图

控制台「**收到的图片**」面板：缩略图墙，显示时间、大小、尺寸，只读不改原图。

### 清理

- 原图：`data\clawbot\blobs\`
- 凭证（含媒体地址与密钥，**不要外传**）：`data\clawbot\media\`
- 默认 7 天自动清理，`mediaRetentionDays: 0` 关闭

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

## 隐私与边界

- 只读取**一对一私聊**；接口不支持群聊、主动推送、加好友
- 数据都在本机 `<Coopanion>\data\home\companion\data\clawbot\`
- 发图有路径白名单，只允许 `data/clawbot` 与 `workspace` 两棵子树
- 明确不做：发语音（实测服务端不投递）、引用回复、收发文件、视频、缩略图

## 许可

MIT，保留上游版权声明。原作者 AqualCross，本分支 大肥鱼 (BigFatFish)。

---

## 写在最后

上游把最难的一半做完了：扫码、长轮询、会话过期。这半边是从那条路接着往前走的。

我本来以为最难的是协议。后来发现不是——最难的是**不信文档**。那个说"图片和语音先做成占位"的
注释骗了所有人，直到有人真的把报文打出来看了一眼。剩下的工作，大多只是把"猜"换成"看"。

有两个 bug 我到现在还挺得意：一个漏了 `to_user_id`，一个漏了 `filekey`。修复各花两分钟，
找出来花了几天。它们都只回一个 `-2`，什么都不解释。

如果你用着顺手，也去给上游点个 star。

—— 大肥鱼
