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
  echo [错误] 没有检测到 Node.js。
  echo 请先到 https://nodejs.org 下载安装 Node.js 的 LTS 版本，
  echo 装好后重新双击本脚本即可。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 正在安装依赖，请稍候……
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在打包 Windows 安装程序……
echo 首次打包会下载 Electron 运行时，可能需要几分钟，请耐心等待，不要关闭窗口。
echo.
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
echo    安装包在 dist 文件夹里，文件名形如：
echo        轻记 Setup 1.0.0.exe
echo    双击它即可在 Windows 上安装。
echo ============================================
echo.
if exist dist explorer dist
pause
