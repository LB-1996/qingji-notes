#!/bin/bash
# Mac 上双击即可启动轻记（首次或有新依赖时会自动安装）
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "没有检测到 Node.js，请先到 https://nodejs.org 下载安装 LTS 版本。"
  read -n 1 -s -r -p "按任意键退出……"
  exit 1
fi

# node_modules 缺失、或缺少新依赖(如同步用的 ws) → 安装
if [ ! -d node_modules ] || [ ! -d node_modules/ws ] || [ ! -d node_modules/bonjour-service ]; then
  echo "正在安装 / 更新依赖，请稍候……"
  npm install || { echo "依赖安装失败，请检查网络。"; read -n 1 -s -r -p "按任意键退出……"; exit 1; }
fi

echo "正在启动轻记……关闭应用窗口即退出。"
npm start
