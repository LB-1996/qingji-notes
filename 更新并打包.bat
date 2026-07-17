@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 轻记 · 更新并打包安装包
set GIT_TERMINAL_PROMPT=0

echo ============================================
echo    轻记 · 拉取最新代码，打包成 Windows 安装包
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

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [注意] 当前文件夹不是用 git clone 下载的，无法自动更新！
  echo        请用下面命令克隆一份，然后改用克隆出来的文件夹：
  echo            git clone https://github.com/LB-1996/qingji-notes.git
  echo        本次仍会用当前代码打包……
  echo.
  pause
) else (
  call :update_code
)

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo 正在检查并安装依赖，请稍候……
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
echo    安装包在 dist 文件夹里：轻记 Setup 1.4.0.exe
echo    双击它安装，之后就能像普通软件一样打开使用了。
echo ============================================
echo.
if exist dist explorer dist
pause
goto :eof


REM ===== 更新代码：官方连不上就自动换国内镜像；用 fetch + reset --hard 强制对齐远端， =====
REM =====          避免换行符等本地噪音导致"拉不到代码"。                              =====
:update_code
set "BR="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BR=%%b"
if "%BR%"=="" set "BR=main"
echo 正在从 GitHub 获取最新代码（分支 %BR%）……

call :fetch_reset origin
if not errorlevel 1 goto update_ok
echo    官方连不上，改用国内镜像重试……
call :fetch_reset https://ghfast.top/https://github.com/LB-1996/qingji-notes.git
if not errorlevel 1 goto update_ok
call :fetch_reset https://kkgithub.com/LB-1996/qingji-notes.git
if not errorlevel 1 goto update_ok
call :fetch_reset https://gitclone.com/github.com/LB-1996/qingji-notes.git
if not errorlevel 1 goto update_ok
echo [注意] 官方和所有镜像暂时都连不上（网络不稳定），本次用现有代码继续。
echo.
goto :eof
:update_ok
echo ✅ 代码已更新到最新。
echo.
goto :eof

REM 参数1=远程地址；抓取后硬对齐到远端最新提交（会丢弃本地对代码的改动——正常使用不该有）
:fetch_reset
git fetch "%~1" %BR%
if errorlevel 1 exit /b 1
git reset --hard FETCH_HEAD >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0
