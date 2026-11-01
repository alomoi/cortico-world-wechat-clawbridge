# 发布记录：GitHub + npm

> 状态：✅ **已上线**（1.6.3 于 2026-10-31，1.6.4 于 2026-11-01）
> 仓库：https://github.com/alomoi/cortico-world-wechat-clawbridge
> npm：https://www.npmjs.com/package/cortico-world-wechat-clawbridge

## 最终结果

| 项 | 结果 |
|---|---|
| GitHub 仓库 | public，MIT，43 个文件（0.26 MB） |
| 最新提交 | `34c84ca`（1.6.4） |
| 标签 / Release | `v1.6.3`、`v1.6.4`（各带 4 个离线安装附件） |
| npm | `@1.6.4`（latest 指向它） |
| 包内容 | 28 个文件，185 KB（解包），依赖 jimp/qrcode/undici |
| 市场索引 | `Pal-AI-Lab/cortico-extensions` 定期扫 npm，通常几小时到一天后收录 |

## 发版流程（现在由大肥鱼代发）

主人把 token 给本鱼 → 本鱼写进 `~/.npmrc` → `pnpm publish` → **发布后立刻删掉 token**。

> 更安全的做法：把 token 存成 `D:\文档\deepseek-harness\default-workspace\.npm-token` 文件，
> 本鱼读文件、不打印，就不必经过聊天记录。

## 这次踩的坑（重要，下次别再踩）

### 8. 发布成功后查不到 1.6.4，不是失败，是 CDN 缓存
- `pnpm publish` 返回 `✅ Published`，但 `registry.npmjs.org/<包>/1.6.4` 一直 **404**，
  packument 里也还只有 1.6.3 —— 连等 45 秒都没变。
- 真相：**registry 的 CDN 边缘缓存没刷新**。
- 可靠的验证方法（按顺序）：
  1. `npm view <包> versions --json`（带鉴权，走的是另一条缓存路径）
  2. `npm view <包> dist-tags --json` 看 latest 指到哪
  3. **jsDelivr 镜像**读实际文件：`https://cdn.jsdelivr.net/npm/<包>@<版本>/package.json`
  4. 直接 HEAD tarball：`https://registry.npmjs.org/<包>/-/<包>-<版本>.tgz`
- 结论：**别再因为匿名查询 404 就以为发布失败、然后重发一次**（重发会报 `cannot publish over`）。

### 9. 安装脚本必须核对「版本」，不能只看「包在不在」
- `install.ps1` 原先只检查 `node_modules/<包>/package.json` 是否存在。
- 实测：pnpm 因 `ERR_PNPM_NO_OFFLINE_META` 挂了，但旧版本还在目录里 →
  脚本兴高采烈打印「✅ 已安装 1.6.3」，其实**一步都没做**。
- 修法：先从 tgz 里读出应有的版本，装完逐个比对；不一致就报错，并在报错里给出日志路径。
- 另外：`--offline` 解析不到元数据时（包已发布到 npm 会更常见），要**自动退回联网安装**。

### 1. npm 官网被 Cloudflare 拦机房 IP
- 客户机出口是东京机房 IP → `www.npmjs.com` 全站 403，`registry.npmjs.org` 却 200
- 直连大陆家宽同样打不开官网（TLS 直接断）
- **注册/建 token 只能在能打开官网的网络里做**（境外住宅 IP、手机蜂窝等）

### 2. pnpm 11 不再读 package.json 的 `pnpm` 字段
- 会打印 `The "pnpm" field in package.json is no longer read by pnpm`
- 设置要放 `pnpm-workspace.yaml`（这里放的是 `strictDepBuilds: false`，
  否则安装 esbuild 时 `ERR_PNPM_IGNORED_BUILDS` 会让 `pnpm install` 退出码 1）

### 3. `prepublishOnly` 指向不存在的文件
- 早期遗留的 `scripts` 里有 `prepublishOnly: node tools/check.mjs`，
  而 `tools/check.mjs` 早已删除 → `pnpm publish` 最后一步必失败
- 发布前务必 `pnpm pack --dry-run` 走一遍

### 4. 新包首发走「暂存发布」（staged publishing）
- 第一次 `pnpm publish` 后，registry 上只看到 `0.0.0-stage` 占位版本
- 稍等再查（或换 URL 参数绕缓存）就能看到 `1.6.3`，`dist-tags.latest` 也会指向它
- 再发一次会报 `cannot publish over ...` —— 那说明**上一条其实成功了**，别慌

### 5. granular token 的权限要点
- `Packages and scopes` 必须选 **Read and write (publish and stage)**
- 必须选 **All packages**，否则发不了新包
- 账号开了 2FA 时，CLI 发布要么带 `--otp=123456`，要么用勾了
  **Bypass two-factor authentication** 的 token
- 这种 bypass token 相当于"无 2FA 的发布权"，**用完必须吊销**

### 6. token 存放的位置不止一个
- `pnpm config set //registry.npmjs.org/:_authToken=...` 写的是 **pnpm 自己的配置文件**，
  `~/.npmrc` 可能根本不存在 → npm CLI / `npm stage` 读不到，会 401
- 两个工具混用时，直接写 `~/.npmrc` 最保险

### 7. Git for Windows 的小问题
- `credential.helper` 指到带空格的路径（`C:/Program Files/...`）会被 shell 截断 →
  用 8.3 短路径或把目录加进 PATH
- 本机 GCM（Git Credential Manager）一启动就崩（`0xE0434352` .NET 异常），
  退回 `credential.helper = wincred`
- 代理软件若是 TUN/全局模式，git 仍可能不走代理 → 显式
  `git config --global http.proxy` / `https.proxy`

## 下次发版的流程

```powershell
# 1) 改 plugin/package.json 的 version
# 2) 自检
cd plugin
pnpm pack --dry-run
node tools/describe.mjs

# 3) 发布（token 只在需要时临时设置）
pnpm config set //registry.npmjs.org/:_authToken=npm_xxx
pnpm publish --access public
pnpm config delete //registry.npmjs.org/:_authToken

# 4) 仓库打标签
cd ..
git add -A
git commit -m "release: 1.6.x"
git tag -a v1.6.x -m "1.6.x"
git push && git push --tags

# 5) 重打离线包并挂到 Release
cd plugin && node tools/build-offline.mjs
```

## 备用方案：GitHub Actions 自动发布

如果官网长期进不去、token 难办，可以改成「打 tag 自动发布」：
把 bypass token 存进仓库 Secrets（`NPM_TOKEN`），Action 在 GitHub 的网络上跑
`pnpm publish`。这样本机永远不需要保存 token。需要时再补这个 workflow。
