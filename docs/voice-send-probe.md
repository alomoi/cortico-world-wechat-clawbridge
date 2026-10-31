# 实测记录：微信 bot 能否发语音

> 结论：**不可行**（2026-10-31 实测）。服务端接受请求并返回 `message_id`，
> 但微信客户端**不显示任何内容**。普通文字走同一条路可以正常送达。

## 实验方法

不经过插件，用一次性脚本直接打接口，排除插件因素：

```
SAPI 合成 24000Hz/16bit/mono WAV
  → ① 转 SILK（silk-wasm，encode_type=6）
  → ② 或直接用 PCM（encode_type=1）
  → getuploadurl(media_type=4)
  → 上传密文，取 x-encrypted-param
  → sendmessage，item type=3（VOICE）
```

## 结果

| 实验 | 上传 | sendmessage | 微信收到 |
|---|---|---|---|
| SILK（36.5 KB / 10780 ms） | ✅ 200 | ✅ `message_id: 7522145323068637000` | ❌ 无任何显示 |
| PCM（505 KB / 10775 ms） | ✅ 200 | ✅ `message_id: 7522146927096276000` | ❌ 无任何显示 |
| **对照：普通文字** | — | ✅ `message_id: 7522145825378450440` | ✅ 正常收到 |

对照组说明：收件人 id、`context_token`、鉴权、网络都正常，**只有语音类型被静默丢弃**。

## 补充证据

- `getuploadurl` 对 `media_type` **有校验**：`4`（语音）与 `3`（文件）通过，`9`（非法）返回 `ret=-2`。
  → 说明"语音可上传"是服务端认可的，问题卡在投递环节。
- 官方 `@tencent-weixin/openclaw-weixin@2.4.10` 的 `send-media.ts` 只有
  视频 / 图片 / 文件三条分支，**从没实现过发语音**——与实测一致。

## 请求结构（若将来重试）

```jsonc
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<对方 @im.wechat>",
    "client_id": "probe-voice-<ts>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{
      "type": 3,                      // MessageItemType.VOICE
      "voice_item": {
        "media": {
          "encrypt_query_param": "<上传后拿到的 x-encrypted-param>",
          "aes_key": "<base64(32位hex密钥)>",
          "encrypt_type": 1
        },
        "encode_type": 6,             // 1=pcm 2=adpcm 3=feature 4=speex 5=amr 6=silk 7=mp3 8=ogg-speex
        "bits_per_sample": 16,
        "sample_rate": 24000,
        "playtime": 10780,            // 毫秒
        "text": "<可选：转写文本>"
      }
    }],
    "context_token": "<入站消息的 context_token>"
  },
  "base_info": { "channel_version": "1.0.0", "bot_agent": "..." }
}
```

## 重试工具

`tools/voice-send-probe.mjs`（需要先在该目录 `pnpm add silk-wasm`，或改成 PCM 模式免依赖）。

用法：

```bash
node tools/voice-send-probe.mjs <测试.wav> [--pcm]
```

它会打印每一步的返回，最后告诉你微信端该不该有反应。

## 如果将来解禁

1. 先用上面的脚本确认能投递
2. 再考虑接 TTS（本机 `Microsoft Huihui` 是机械音；自然音质需要在线 TTS）
3. 最后才是接进 `clawbridge_send`（加 `voice: "<文本>"` 参数，复用上传链路）
