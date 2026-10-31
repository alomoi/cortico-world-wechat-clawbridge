# 发布记录：GitHub + npm

> 状态：✅ **已上线**（2026-10-31）
> 仓库：https://github.com/alomoi/cortico-world-wechat-clawbridge
> npm：https://www.npmjs.com/package/cortico-world-wechat-clawbridge

## 最终结果

| 项 | 结果 |
|---|---|
| GitHub 仓库 | public，MIT，43 个文件 |
| 提交 | `e59c573`（首发）→ `3de37e2`（清理失效 scripts） |
| 标签 | `v1.6.3` |
| npm | `cortico-world-wechat-clawbridge@1.6.3` |
| 包内容 | 28 个文件，185 KB（解包），依赖 jimp/qrcode/undici |
| 市场索引 | `Pal-AI-Lab/cortico-extensions` 定期扫 npm，通常几小时到一天后收录 |

## 这次踩的坑（重要，下次别再踩）

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
