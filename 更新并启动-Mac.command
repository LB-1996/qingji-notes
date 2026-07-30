#!/bin/bash
# Mac 上双击本文件：先从 GitHub 拉取最新代码，再启动「轻记」
cd "$(dirname "$0")"

REPO="https://github.com/LB-1996/qingji-notes.git"
# 官方连不上时依次尝试的国内镜像
MIRRORS=(
  "$REPO"
  "https://ghfast.top/https://github.com/LB-1996/qingji-notes.git"
  "https://kkgithub.com/LB-1996/qingji-notes.git"
  "https://gitclone.com/github.com/LB-1996/qingji-notes.git"
)

pause_exit() { echo ""; read -n 1 -s -r -p "按任意键退出……"; exit "${1:-1}"; }

echo "============================================"
echo "   轻记 · 拉取最新代码并启动"
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
  echo "代码已更新到最新（版本 $(node -p "require('./package.json').version" 2>/dev/null)）。"
else
  echo "[注意] 官方和所有镜像暂时都连不上，本次用现有代码继续。"
fi
echo ""

# 依赖缺失（含同步用的 ws / bonjour-service）就安装
if [ ! -d node_modules ] || [ ! -d node_modules/ws ] || [ ! -d node_modules/bonjour-service ]; then
  echo "正在安装 / 更新依赖，请稍候……"
  npm install || { echo "[错误] 依赖安装失败，请检查网络。"; pause_exit 1; }
fi

echo "正在启动轻记……关闭应用窗口即退出。"
npm start
