@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 轻记 · 打包 Windows 安装包

echo ============================================
echo    轻记 · 打包 Windows 安装包
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。请先到 https://nodejs.org 安装 LTS 版本，再双击本脚本。
  echo.
  pause
  exit /b 1
)

REM ---- 国内镜像加速 ----
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

REM ---- 若 node_modules 是从别的系统拷来的，清掉重装 ----
if exist "node_modules" if not exist "node_modules\electron\dist\electron.exe" (
  echo 检测到 node_modules 不是本机安装的，正在清理后重装……
  rmdir /s /q node_modules
)

REM ---- 装 / 更新依赖（确保新依赖也装上）----
echo 正在安装 / 更新依赖，请稍候……
call npm install --registry=https://registry.npmmirror.com
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo 正在打包 Windows 安装包，首次会下载运行时，请耐心等待，不要关闭窗口……
call npm run build:win
if errorlevel 1 (
  echo.
  echo [错误] 打包失败。请把上面的错误信息截图发我。
  pause
  exit /b 1
)

echo.
echo ============================================
echo    打包完成！
echo    安装包在 dist 文件夹里：轻记 Setup 1.3.1.exe
echo    双击它安装，之后就能像普通软件一样打开使用了。
echo ============================================
echo.
if exist dist explorer dist
pause
