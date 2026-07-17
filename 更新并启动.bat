@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 轻记 · 更新并启动

echo ============================================
echo    轻记 · 从 GitHub 拉取最新代码并启动
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Git。请先到 https://git-scm.com/download/win 安装（一路默认即可），再双击本脚本。
  echo.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。请先到 https://nodejs.org 安装 LTS 版。
  echo.
  pause
  exit /b 1
)

REM ---- 必须是 git clone 的文件夹才能自动更新 ----
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [注意] 当前文件夹不是用 git clone 下载的，无法自动更新！
  echo        请用下面命令克隆一份，然后改用克隆出来的文件夹：
  echo            git clone https://github.com/LB-1996/qingji-notes.git
  echo        本次仍会用当前代码启动……
  echo.
  pause
) else (
  echo 正在从 GitHub 拉取最新代码……
  git pull
  echo.
)

REM ---- 国内镜像加速 ----
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

REM ---- 每次都装/更新依赖（新版本可能新增依赖，如局域网同步用到的库）----
echo 正在检查并安装依赖（首次或有更新时会下载，请稍候）……
call npm install --registry=https://registry.npmmirror.com
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo.
echo 正在启动轻记……关闭应用窗口即退出。
echo.
call npm start
if errorlevel 1 (
  echo.
  echo [提示] 应用已退出。如果是异常退出，请把上面的信息发我。
  pause
)
