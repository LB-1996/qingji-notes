#!/bin/bash
# Mac 上双击即可启动轻记（首次会自动安装依赖）
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "没有检测到 Node.js，请先到 https://nodejs.org 下载安装 LTS 版本。"
  read -n 1 -s -r -p "按任意键退出……"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖，请稍候……"
  npm install || { echo "依赖安装失败，请检查网络。"; read -n 1 -s -r -p "按任意键退出……"; exit 1; }
fi

echo "正在启动轻记……关闭应用窗口即退出。"
npm start
