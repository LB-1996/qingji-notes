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
if errorlevel 1 goto no_git
where node >nul 2>nul
if errorlevel 1 goto no_node

REM ---- 确保是 git 仓库；不是就地初始化，好从 GitHub 自动更新（网页ZIP/源码包都能用）----
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 call :init_repo
call :update_code

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo 正在检查并安装依赖，请稍候……
call npm install --registry=https://registry.npmmirror.com
if errorlevel 1 goto dep_fail

echo 正在打包 Windows 安装包，首次会下载运行时，请耐心等待，不要关闭窗口……
call npm run build:win
if errorlevel 1 goto build_fail

echo.
echo ============================================
echo    打包完成！安装包在 dist 文件夹里。
echo    双击它安装，之后就能像普通软件一样打开使用了。
echo ============================================
echo.
if exist dist explorer dist
pause
goto :eof


:no_git
echo [错误] 没有检测到 Git。请先到 https://git-scm.com/download/win 安装（一路默认即可），再双击本脚本。
echo.
pause
exit /b 1

:no_node
echo [错误] 没有检测到 Node.js。请先到 https://nodejs.org 安装 LTS 版本，再双击本脚本。
echo.
pause
exit /b 1

:dep_fail
echo.
echo [错误] 依赖安装失败，请检查网络后重试。
pause
exit /b 1

:build_fail
echo.
echo [错误] 打包失败。请把上面的错误信息截图发我。
pause
exit /b 1

REM ---- 首次：把普通文件夹变成可自动更新的 git 仓库 ----
:init_repo
echo 首次使用：正在初始化自动更新通道……
git init >nul 2>nul
git remote add origin https://github.com/LB-1996/qingji-notes.git >nul 2>nul
goto :eof

REM ---- 更新代码：官方连不上就自动换国内镜像；fetch + reset --hard 强制对齐远端 ----
:update_code
echo 正在从 GitHub 获取最新代码……
call :fetch_reset origin
if not errorlevel 1 goto update_ok
echo    官方连不上，改用国内镜像重试……
call :fetch_reset https://ghfast.top/https://github.com/LB-1996/qingji-notes.git
if not errorlevel 1 goto update_ok
call :fetch_reset https://kkgithub.com/LB-1996/qingji-notes.git
if not errorlevel 1 goto update_ok
call :fetch_reset https://gitclone.com/github.com/LB-1996/qingji-notes.git
if not errorlevel 1 goto update_ok
echo [注意] 官方和所有镜像暂时都连不上，本次用现有代码继续。
echo.
goto :eof
:update_ok
echo 代码已更新到最新。
echo.
goto :eof

REM 参数1=远程地址；抓取 main 后硬对齐（丢弃换行符等本地噪音；node_modules/dist 被忽略不受影响）
:fetch_reset
git fetch "%~1" main
if errorlevel 1 exit /b 1
git reset --hard FETCH_HEAD >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0
