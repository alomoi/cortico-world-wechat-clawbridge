# 发布指南：GitHub + npm

> 目标：把仓库开源到 GitHub，再把包发到 npm，让人能在 Coopanion 扩展市场搜到。
> **只有两步需要你本人**：装 Git + 用你的账号推送/发布。其余都已准备好。

## 现状（v1.6.3）

| 项 | 状态 |
|---|---|
| 包名 | `cortico-world-wechat-clawbridge` |
| 版本 | 1.6.3 |
| `private` | ✅ 已移除（否则 npm 拒绝发布） |
| 仓库字段 | ✅ 指向 `alomoi/cortico-world-wechat-clawbridge` |
| 关键字 | ✅ 含 `cortico-world`（市场靠它检索） |
| 市场卡片 | ✅ 中文/英文显示名与简介、图标 `icon.png` |
| describe.json | ✅ 3 个工具 + 1 个事件 |
| 要公开的文件 | 42 个，约 259 KB（已扫描：无真实微信 ID、无密钥） |

## 第 1 步：装 Git

```powershell
winget install --id Git.Git -e --source winget
```

装完**重开终端**，确认 `git --version` 有输出。然后配置身份（只需一次）：

```powershell
git config --global user.name "alomoi"
git config --global user.email "你的邮箱"
```

## 第 2 步：建 GitHub 仓库

<https://github.com/new>

- 仓库名：`cortico-world-wechat-clawbridge`
- **不要**勾 README / .gitignore / license（本地已有）

## 第 3 步：推送

```powershell
cd "D:\文档\deepseek-harness\default-workspace\clawbridge"
git init -b main
git add .
git status
```

**先看 `git status`**：应该只有 42 个文件，不应该出现 `tests/`、`node_modules/`、`dist/`、`docs/fish-handoff.md`。
确认无误再：

```powershell
git commit -m "feat: 微信 ClawBridge 1.6.3 — 把微信 ClawBot 接到 Coopanion 桌宠"
git remote add origin https://github.com/alomoi/cortico-world-wechat-clawbridge.git
git push -u origin main
```

> GitHub 已不接受账号密码，需要 **Personal Access Token**：
> Settings → Developer settings → Personal access tokens → 勾 `repo`。
> 用户名填 `alomoi`，密码处粘贴 token。
> 嫌麻烦可以用 [GitHub Desktop](https://desktop.github.com/)。

## 第 4 步：发到 npm

```powershell
cd "D:\文档\deepseek-harness\default-workspace\clawbridge\plugin"
pnpm login
pnpm publish --access public
```

常见问题：

| 情况 | 处理 |
|---|---|
| 包名被占用 | 改用 scope：`@alomoi/cortico-world-wechat-clawbridge`（改 `package.json` 的 `name`），`cortico-world` 关键字必须保留 |
| 要求 2FA | `pnpm publish --access public --otp=123456` |
| 想先看看会发哪些文件 | `pnpm pack` 后 `tar -tzf *.tgz` |

发完确认：

```powershell
npm view cortico-world-wechat-clawbridge version
```

## 第 5 步：挂 Release（可选，给离线包用）

GitHub 仓库 → Releases → Draft a new release：

- Tag：`v1.6.3`
- 附件：`dist/offline/cortico-world-wechat-clawbridge-1.6.3-offline.tgz`、`install.bat`、`install.ps1`、`INSTALL.txt`

这样 README 里"去 Releases 下载离线包"这条路径才成立。

## 第 6 步：验证市场

1. 打开 Coopanion 的扩展市场，搜 `cortico-world` 或 `微信`
2. 找到后安装（从 npm 拉包，依赖自动装好）
3. 启用 → 「微信绑定」面板 → 扫码

> 市场索引在 `Pal-AI-Lab/cortico-extensions`，由 Action 扫 npm 生成 `catalog.json`，
> 所以**发 npm 之后要等它扫一轮**（当天到一天不等）。

## 之后每次发版

```powershell
# 1) 改 plugin/package.json 的 version
# 2) 重新打包并自检
cd plugin
pnpm pack
node tools/build-offline.mjs   # 需要离线包时
# 3) 发布
pnpm publish --access public
# 4) 打 tag 并推
git tag v1.6.4 && git push --tags
```

## 我（大肥鱼）没法代做的

- GitHub 账号与 token（推送）
- npm 账号与 token（发布）

这两步之后，验证、排错、市场收录检查我都能接。
