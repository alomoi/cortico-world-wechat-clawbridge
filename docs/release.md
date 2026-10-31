# 发行：离线安装包

> 目标：别人下载一个压缩包，双击就能装，**不需要联网、不需要装 Node**。
> 状态：✅ 本机完整验证通过（2026-10-31）。

## 产物

```
dist/offline/
├─ cortico-world-wechat-clawbridge-1.5.1-offline.tgz   0.61 MB（含全部依赖）
├─ install.ps1                                          安装脚本（UTF-8 BOM）
├─ install.bat                                          双击入口（带 Bypass）
└─ INSTALL.txt                                          给使用者的说明
```

## 构建

```bash
node plugin/tools/build-offline.mjs      # 生成 plugin/build-offline/ 暂存目录
cd plugin/build-offline && pnpm pack     # 打成 tgz，再移到 dist/offline/
```

构建做了这些事：

1. **esbuild 把 `jimp` / `undici` / `qrcode` 打进单个 `dist/index.js`**（约 3 MB，压缩后 0.6 MB）
2. 复制 `ENV_PROMPT.md` 到 `dist/`（代码用 `import.meta.url` 定位它）
3. 复制 `src/webui/client.js`（WebUI 单独加载，不参与 bundle）
4. 改写 `package.json`：`main` 指向 bundle、**`dependencies: {}`**

因为依赖为空，`pnpm add` 用 `--offline` 也不会联网。

## 安装脚本做了什么

```
1. 探测 Coopanion（%LOCALAPPDATA%\Programs\Coopanion 等）
2. 检查没在运行
3. 找自带 pnpm（resources/app/node_modules/pnpm/bin/pnpm.cjs）与 store
4. ELECTRON_RUN_AS_NODE=1 + Start-Process -Wait 跑 pnpm add <tgz> --offline
5. 校验 node_modules 里的版本再报成功
```

## 踩过的坑（都修了，别重踩）

| 坑 | 现象 | 解法 |
|---|---|---|
| **PS 5.1 读无 BOM 的 UTF-8** | 中文全乱、脚本解析失败 | 脚本必须存成 **UTF-8 BOM**；每次用编辑工具改完都要补 BOM |
| **执行策略** | 双击 .ps1 直接报「禁止运行脚本」 | 附 `install.bat`，用 `-ExecutionPolicy Bypass` 调起 |
| **Electron 是 GUI 子系统** | `& $exe` 不等待，脚本抢跑导致假失败 | 用 `Start-Process -Wait -PassThru`，并用 `$LASTEXITCODE` 之外的结果校验 |
| **esbuild 的 ESM 动态 require** | qrcode 里的 `require('fs')` 抛 `Dynamic require of "fs" is not supported` | 用 ESM + banner 注入真实 `require`（`createRequire(import.meta.url)`）；**不要**用 CJS 格式（`import.meta` 会为空） |
| **裸 `{ }` 脚本块** | 代码被当字面量打印出来 | PowerShell 里单独一段 `{ ... }` 是 scriptblock 表达式 |
| pnpm 日志乱码 | 安装输出里 ✓ 变成乱码 | `Get-Content -Encoding UTF8` |

## 兼容性说明

- 安装脚本按 **Windows PowerShell 5.1** 写：不用 `&&`、`??`、三元运算
- 已用真实的 5.1 解析器校验语法
- 打包用 `pnpm pack`（不依赖 npm）

## 还没做的

- 上架 Coopanion 插件市场（需要发到 npm，见 roadmap 的「发行」）
- 图标（`cortico.icon`）与中英简介（`locales`）
- 隐私政策文档
