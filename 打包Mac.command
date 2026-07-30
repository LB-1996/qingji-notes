#!/bin/bash
# Mac 上双击本文件即可把「轻记」打包成正式 App（生成 dmg 安装镜像）
cd "$(dirname "$0")"

echo "============================================"
echo "   轻记 · 打包 Mac App"
echo "============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js，请先到 https://nodejs.org 下载安装 LTS 版本。"
  read -n 1 -s -r -p "按任意键退出……"
  exit 1
fi

# 依赖缺失（含同步用的 ws / bonjour-service）就安装
if [ ! -d node_modules ] || [ ! -d node_modules/ws ] || [ ! -d node_modules/bonjour-service ] || [ ! -d node_modules/electron-builder ]; then
  echo "正在安装 / 更新依赖，请稍候……"
  npm install || { echo "[错误] 依赖安装失败，请检查网络。"; read -n 1 -s -r -p "按任意键退出……"; exit 1; }
fi

if [ "$(uname -m)" != "arm64" ]; then
  echo ""
  echo "[注意] 当前是 Intel 芯片的 Mac，而打包配置里只写了 arm64（Apple 芯片）。"
  echo "       要打 Intel 版，把 package.json 里 build.mac.target 的 arch 改成 x64 再来一次。"
  echo ""
fi

echo "正在打包，请耐心等待（几分钟），不要关闭窗口……"
npm run build:mac || { echo "[错误] 打包失败，请把上面的错误信息发我。"; read -n 1 -s -r -p "按任意键退出……"; exit 1; }

# 版本号从 package.json 读，别写死（以前写死成 1.4.0，升版后提示就不对了）
VER=$(node -p "require('./package.json').version" 2>/dev/null)
DMG="dist/轻记-${VER}-arm64.dmg"
echo ""
echo "============================================"
echo "   打包完成！版本 ${VER}"
if [ -f "$DMG" ]; then
  echo "   1. dmg 安装镜像：${DMG}"
  echo "      双击打开，把「轻记」拖进「应用程序」文件夹即可。"
else
  echo "   1. dmg 安装镜像在 dist 文件夹里。"
fi
echo "   2. 也可直接用：dist/mac-arm64/轻记.app"
echo "============================================"
echo ""
open dist
read -n 1 -s -r -p "按任意键关闭本窗口……"
