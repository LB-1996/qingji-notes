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

REM ---- 必须是 git clone 的文件夹才能自动更新 ----
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [注意] 当前文件夹不是用 git clone 下载的，无法自动更新！
  echo        请用下面命令克隆一份，然后改用克隆出来的文件夹：
  echo            git clone https://github.com/LB-1996/qingji-notes.git
  echo        本次仍会用当前代码打包……
  echo.
  pause
) else (
  call :pull_latest
)

REM ---- 国内镜像加速 ----
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

REM ---- 每次都装/更新依赖（新版本可能新增依赖）----
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
echo    安装包在 dist 文件夹里：轻记 Setup 1.1.0.exe
echo    双击它安装，之后就能像普通软件一样打开使用了。
echo ============================================
echo.
if exist dist explorer dist
pause
goto :eof


REM ================= 子程序：拉取最新代码（官方失败自动换国内镜像）=================
:pull_latest
set "BR="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BR=%%b"
if "%BR%"=="" set "BR=main"

echo 正在从 GitHub 拉取最新代码（分支 %BR%）……
git pull --ff-only origin %BR%
if not errorlevel 1 goto pull_ok

echo.
echo 官方 GitHub 连不上，自动切换国内镜像重试……
echo   [1/3] ghfast 镜像……
git pull --ff-only https://ghfast.top/https://github.com/LB-1996/qingji-notes.git %BR%
if not errorlevel 1 goto pull_ok

echo   [2/3] kkgithub 镜像……
git pull --ff-only https://kkgithub.com/LB-1996/qingji-notes.git %BR%
if not errorlevel 1 goto pull_ok

echo   [3/3] gitclone 镜像……
git pull --ff-only https://gitclone.com/github.com/LB-1996/qingji-notes.git %BR%
if not errorlevel 1 goto pull_ok

echo.
echo [注意] 官方和所有镜像暂时都连不上（网络不稳定）。
echo        本次先用你电脑上现有的代码继续打包，只是可能不是最新。
echo        过一会儿网络好点，再双击本脚本即可更新到最新。
echo.
goto :eof

:pull_ok
echo ✅ 代码已是最新。
echo.
goto :eof
