#!/bin/bash
# Mac 上双击本文件：先从 GitHub 拉取最新代码，再打包成正式 App（生成 dmg 安装镜像）
cd "$(dirname "$0")"

REPO="https://github.com/LB-1996/qingji-notes.git"
# 官方连不上时依次尝试的国内镜像
MIRRORS=(
  "$REPO"
  "https://ghfast.top/https://github.com/LB-1996/qingji-notes.git"
  "https://kkgithub.com/LB-1996/qingji-notes.git"
  "https://gitclone.com/github.com/LB-1996/qingji-notes.git"
)
# 下载 Electron 运行时走国内镜像，首次打包快很多
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

pause_exit() { echo ""; read -n 1 -s -r -p "按任意键退出……"; exit "${1:-1}"; }

echo "============================================"
echo "   轻记 · 拉取最新代码，打包 Mac App"
echo "============================================"
echo ""

if ! command -v git >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Git。"
  echo "       Mac 上打开「终端」输入 xcode-select --install 即可安装（或到 https://git-scm.com 下载）。"
  pause_exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js，请先到 https://nodejs.org 下载安装 LTS 版本。"
  pause_exit 1
fi

# ---- 确保是 git 仓库；不是就地初始化，这样从网页下载的 ZIP 源码包也能自动更新 ----
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "首次使用：正在初始化自动更新通道……"
  git init >/dev/null 2>&1
  git remote add origin "$REPO" >/dev/null 2>&1
fi

# ---- 拉取最新代码：fetch + reset --hard 强制对齐远端（node_modules / dist 已被忽略，不受影响）----
echo "正在从 GitHub 获取最新代码……"
updated=0
for url in "${MIRRORS[@]}"; do
  if git fetch "$url" main >/dev/null 2>&1 && git reset --hard FETCH_HEAD >/dev/null 2>&1; then
    updated=1
    break
  fi
  echo "   连不上，换下一个地址重试……"
done
if [ "$updated" = "1" ]; then
  echo "代码已更新到最新。"
else
  echo "[注意] 官方和所有镜像暂时都连不上，本次用现有代码继续。"
fi
echo ""

echo "正在检查并安装依赖，请稍候……"
npm install || { echo "[错误] 依赖安装失败，请检查网络。"; pause_exit 1; }

if [ "$(uname -m)" != "arm64" ]; then
  echo ""
  echo "[注意] 当前是 Intel 芯片的 Mac，而打包配置里只写了 arm64（Apple 芯片）。"
  echo "       要打 Intel 版，把 package.json 里 build.mac.target 的 arch 改成 x64 再来一次。"
  echo ""
fi

echo "正在打包，请耐心等待（几分钟），不要关闭窗口……"
npm run build:mac || { echo "[错误] 打包失败，请把上面的错误信息发我。"; pause_exit 1; }

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
