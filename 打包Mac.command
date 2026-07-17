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

echo "正在打包，请耐心等待（几分钟），不要关闭窗口……"
npm run build:mac || { echo "[错误] 打包失败，请把上面的错误信息发我。"; read -n 1 -s -r -p "按任意键退出……"; exit 1; }

echo ""
echo "============================================"
echo "   打包完成！"
echo "   1. dmg 安装镜像：dist/轻记-1.3.0-arm64.dmg"
echo "      双击打开，把「轻记」拖进「应用程序」文件夹即可。"
echo "   2. 也可直接用：dist/mac-arm64/轻记.app"
echo "============================================"
echo ""
open dist
read -n 1 -s -r -p "按任意键关闭本窗口……"
