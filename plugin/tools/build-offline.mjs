/**
 * 构建离线安装包（依赖全部打进单个 JS，pnpm 安装时无需联网）。
 *
 * 用法：node tools/build-offline.mjs
 * 产物：
 *   build-offline/          打包用的临时目录（可删）
 *   dist/offline/*.tgz      离线安装包（配合 install.ps1 使用）
 *
 * 注意：`webUiClient` 保持为 `src/webui/client.js`（由 WebUI 单独加载，不参与 bundle），
 * 所以包里要保留这个文件。
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));   // plugin/
const STAGE = join(ROOT, 'build-offline');
const OUT = join(ROOT, '..', 'dist', 'offline');                 // clawbridge/dist/offline

const pkgText = await readFile(join(ROOT, 'package.json'), 'utf8');
// PowerShell 写回的文件可能带 BOM，先剥掉再解析
const pkg = JSON.parse(pkgText.replace(/^\uFEFF/, ''));

await rm(STAGE, { recursive: true, force: true });
await mkdir(join(STAGE, 'dist'), { recursive: true });
await mkdir(join(STAGE, 'src', 'webui'), { recursive: true });
await mkdir(OUT, { recursive: true });

// 1) 打 bundle
//    ESM 输出（代码里用 import.meta.url 定位 ENV_PROMPT / package.json），
//    但 qrcode 等 CJS 依赖里有 `require('fs')`，esbuild 会留成动态 require 直接抛错。
//    banner 里先定义真实的 require，esbuild 的 shim 会优先用它。
console.log('打包 main 入口（ESM bundle）…');
await build({
  entryPoints: [join(ROOT, 'src', 'index.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // 保留 UTF-8：默认会把中文转义成 \uXXXX，日志和回执在包里会变得不可读
  charset: 'utf8',
  outfile: join(STAGE, 'dist', 'index.js'),
  banner: {
    js: [
      '// cortico-world-wechat-clawbridge (offline bundle)',
      '// 这一份是把依赖全吞进肚子里打出来的 —— 一条很胖的鱼。  ><((((">',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
});

// 2) 附属文件（ENV_PROMPT 必须与 bundle 同目录：代码用 import.meta.url 定位）
await copyFile(join(ROOT, 'src', 'ENV_PROMPT.md'), join(STAGE, 'dist', 'ENV_PROMPT.md'));
await copyFile(join(ROOT, 'src', 'webui', 'client.js'), join(STAGE, 'src', 'webui', 'client.js'));
for (const f of ['describe.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'icon.png']) {
  try {
    await copyFile(join(ROOT, f), join(STAGE, f));
  } catch {
    /* 可选文件 */
  }
}

// 3) 改写 package.json：指向 bundle、清空依赖
const offlinePkg = {
  ...pkg,
  main: './dist/index.js',
  exports: { '.': './dist/index.js' },
  files: ['dist', 'src/webui', 'describe.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'icon.png'],
  dependencies: {},
  devDependencies: undefined,
  scripts: undefined,
  cortico: { ...(pkg.cortico ?? {}), webUiClient: 'src/webui/client.js', describe: 'describe.json' },
};
await writeFile(join(STAGE, 'package.json'), `${JSON.stringify(offlinePkg, null, 2)}\n`, 'utf8');

console.log('已生成 staging 目录:', STAGE);
console.log('  - dist/index.js（bundle）');
console.log('  - dist/ENV_PROMPT.md');
console.log('  - src/webui/client.js');
console.log('  - package.json（dependencies 已清空）');
console.log('\n下一步：在 build-offline 里跑 pnpm pack，把 tgz 移到 dist/offline/');
