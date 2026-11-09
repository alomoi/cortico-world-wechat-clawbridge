# 搁置项：收发文件

> 状态：**已实现（1.7.0，2026-11-09）**。定案与实现见 [file-transfer-plan.md](./file-transfer-plan.md)。
> 这份文件保留原搁置记录，作为「为什么曾经不做、后来为什么又做」的对照。
> 代码改动量实际：发文件半天 + 收文件半天（与当初估计一致）。

## 为什么搁置

两个理由，都是产品层面的，不是技术层面的：

1. **没有使用场景**：使用者的实际用法里，暂时没有"让她发/收文件"的需求。
2. **和 Coopanion 的隐私约束冲突**：框架对桌宠有一套隐私安全约束，她本身会拒绝随意动电脑里的文件。
   即使插件支持，她大概率也不愿意用，做了也是空转。

## 已经确定的技术方案

### 发文件（媒体类型 3）

复用现有上传链路，只差两处：

```
driver.sendImage()  →  driver.sendFile()
  ① media_type: 1  →  3
  ② image_item     →  file_item { media, file_name, ... }
```

- 上传流程完全一致：`getuploadurl` → AES-128-ECB 加密 → CDN 上传 → `x-encrypted-param` → `sendmessage`
- 必须带 `to_user_id`（踩过的坑，见 milestones M3）
- `file_name` 是对方看到的文件名，建议取原文件名
- 参数形态：`images: ["file:D:\\path\\报告.pdf"]` 或独立参数 `files: [...]`
- 路径白名单沿用 `paths.js`（只允许 `data/clawbot` 与 `workspace` 两棵子树）

### 收文件

- 复用 `captureMediaItems` 的下载链路（AES + PKCS#7 已实现）
- 类型分支：`file_item` / `video_item` 落盘到 `<dataDir>/clawbot/blobs/`
- 事件正文给路径 + 文件名 + 大小，例如：
  `[文件 报告.pdf 2.3 MB …/clawbot/blobs/1793413197981-af0a.pdf]`
- 不解析内容；能读到什么取决于 devtools 世界（`fs_read` / `sh`）是否启用
- 视频同理：只落盘，不分析（模型不看视频）

### 可选增强（当时评估过但没定）

| 项 | 说明 | 结论 |
|---|---|---|
| 视频抽首帧 | 需要 ffmpeg（70MB+） | 不做 |
| 缩略图 `thumb_media` | 已有原图 + 降采样 | 不做 |
| PDF 文本抽取 | 需外部工具或纯 JS 解析库 | 待场景 |

## 恢复这项工作时，先确认

1. 场景出现了吗？（有真实用例再动手）
2. 桌宠本人愿意用吗？（隐私约束下她是否接受）
3. 收文件后有没有办法读？（devtools 的 `fs_read` / `sh` 是否可用）
