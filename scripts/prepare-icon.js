// 打包前自动准备应用图标（Windows 用 .ico，macOS 用 .png 自动转 .icns）：
//   Windows 图标优先级：根目录 logo.ico > 根目录 logo.png > 默认 assets/icon.png
//   macOS  图标优先级：根目录 logo.png > 默认 assets/icon.png（必须是 PNG，≥512×512，建议 1024×1024）
// 选中的图标会被复制到 build/ 目录，electron-builder 会自动从这里取用：
//   build/icon.ico  → Windows
//   build/icon.png  → macOS（electron-builder 会据此生成 .icns）
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
fs.mkdirSync(buildDir, { recursive: true });

// 先清掉上一次生成的图标，避免新旧混用
for (const name of ['icon.ico', 'icon.png']) {
  const p = path.join(buildDir, name);
  if (fs.existsSync(p)) fs.rmSync(p);
}

const logoIco = path.join(root, 'logo.ico');
const logoPng = path.join(root, 'logo.png');
const defaultPng = path.join(root, 'assets', 'icon.png');

// ---- Windows：build/icon.ico ----
let winUsed = null;
if (fs.existsSync(logoIco)) {
  fs.copyFileSync(logoIco, path.join(buildDir, 'icon.ico'));
  winUsed = '根目录 logo.ico';
}

// ---- macOS：build/icon.png（必须是 PNG）----
let macUsed = null;
if (fs.existsSync(logoPng)) {
  fs.copyFileSync(logoPng, path.join(buildDir, 'icon.png'));
  macUsed = '根目录 logo.png';
} else if (fs.existsSync(defaultPng)) {
  fs.copyFileSync(defaultPng, path.join(buildDir, 'icon.png'));
  macUsed = '默认 assets/icon.png';
}

// ---- 若 Windows 没有 .ico，退回用 PNG（electron-builder 会自动转 .ico）----
if (!winUsed) {
  if (fs.existsSync(logoPng)) {
    // build/icon.png 已经复制过了，Windows 也能用它
    winUsed = '根目录 logo.png（自动转 ico）';
  } else if (fs.existsSync(defaultPng)) {
    winUsed = '默认 assets/icon.png（自动转 ico）';
  }
}

console.log('✅ Windows 图标：' + (winUsed || '无（用 Electron 默认图标）'));
console.log('✅ macOS  图标：' + (macUsed || '无（用 Electron 默认图标）'));
