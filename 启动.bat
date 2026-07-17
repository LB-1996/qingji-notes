@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 轻记

echo ============================================
echo    轻记 · 启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。
  echo 请先到 https://nodejs.org 下载安装 Node.js 的 LTS 版本，装好后重新双击本脚本。
  echo.
  pause
  exit /b 1
)

REM ---- 国内镜像加速 ----
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

REM ---- 判断是否需要安装依赖：本机 Electron 缺失，或缺少新依赖(如同步用的 ws) ----
set NEED=0
if not exist "node_modules\electron\dist\electron.exe" set NEED=1
if not exist "node_modules\ws" set NEED=1
if not exist "node_modules\bonjour-service" set NEED=1

if "%NEED%"=="1" (
  REM 若 node_modules 存在但没有本机 Electron，多半是从别的系统拷来的，清掉重装
  if exist "node_modules" if not exist "node_modules\electron\dist\electron.exe" (
    echo 检测到 node_modules 不是本机安装的，正在清理后重装……
    rmdir /s /q node_modules
  )
  echo 正在安装 / 更新依赖，请稍候（首次或有新依赖时会下载）……
  echo.
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在启动轻记……关闭应用窗口即退出。
echo.
call npm start
if errorlevel 1 (
  echo.
  echo [提示] 应用已退出。如果是异常退出，请把上面的信息发我。
  pause
)
