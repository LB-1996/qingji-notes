@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 轻记 · 更新并启动

echo ============================================
echo    轻记 · 从 GitHub 拉取最新代码并启动
echo ============================================
echo.

REM ---- check Git ----
where git >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Git。
  echo 请先到 https://git-scm.com/download/win 下载安装 Git（一路默认下一步即可），
  echo 装好后重新双击本脚本。
  echo.
  pause
  exit /b 1
)

REM ---- must be a git clone to auto-update (a zip-extracted folder is NOT a git repo) ----
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [注意] 当前文件夹不是用 git clone 下载的，无法自动更新！
  echo        你现在用的很可能是"压缩包解压"出来的旧文件夹。
  echo        想要一键更新，请用下面命令克隆一份，然后改用克隆出来的文件夹：
  echo            git clone https://github.com/LB-1996/qingji-notes.git
  echo        本次仍会用当前代码启动……
  echo.
  pause
) else (
  echo 正在从 GitHub 拉取最新代码……
  git pull
  echo.
)

REM ---- hand over to the launch script: install deps if needed + start ----
call "启动.bat"
