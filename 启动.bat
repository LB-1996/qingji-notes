@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 轻记

echo ============================================
echo    轻记 · 启动
echo ============================================
echo.

REM ---- check Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。
  echo 请先到 https://nodejs.org 下载安装 Node.js 的 LTS 版本，
  echo 装好后重新双击本脚本即可。
  echo.
  pause
  exit /b 1
)

REM ---- use China mirror so Electron downloads fast ----
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

REM ---- install deps if local Windows Electron is missing (also heals node_modules copied from another OS) ----
if not exist "node_modules\electron\dist\electron.exe" (
  if exist "node_modules" (
    echo 检测到 node_modules 不是本机安装的，正在清理后重装……
    rmdir /s /q node_modules
  ) else (
    echo 首次运行，正在安装依赖，请稍候……
  )
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
