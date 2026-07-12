// 打包前自动挑选应用图标：
//   1. 优先用根目录的 logo.ico（Windows 首选格式，最清晰）
//   2. 其次用根目录的 logo.png（electron-builder 会自动转成 ico，需 ≥256×256，建议 512×512 以上）
//   3. 都没有就退回项目自带的默认图标 assets/icon.png
// 选中的图标会被复制到 build/ 目录，electron-builder 会自动从这里取用。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
fs.mkdirSync(buildDir, { recursive: true });

// 先清掉上一次生成的图标，避免新旧混用（比如上次是 png、这次换成 ico）
for (const name of ['icon.ico', 'icon.png']) {
  const p = path.join(buildDir, name);
  if (fs.existsSync(p)) fs.rmSync(p);
}

// 按优先级查找，保留原扩展名复制到 build/icon.*
const candidates = [
  { src: path.join(root, 'logo.ico'), dest: path.join(buildDir, 'icon.ico'), label: '根目录 logo.ico' },
  { src: path.join(root, 'logo.png'), dest: path.join(buildDir, 'icon.png'), label: '根目录 logo.png' },
  { src: path.join(root, 'assets', 'icon.png'), dest: path.join(buildDir, 'icon.png'), label: '默认图标 assets/icon.png' }
];

let used = null;
for (const c of candidates) {
  if (fs.existsSync(c.src)) {
    fs.copyFileSync(c.src, c.dest);
    used = c.label;
    break;
  }
}

if (used) {
  console.log('✅ 本次打包使用图标：' + used);
} else {
  console.warn('⚠️  没有找到任何图标（logo.ico / logo.png / assets/icon.png），将使用 Electron 默认图标。');
}
