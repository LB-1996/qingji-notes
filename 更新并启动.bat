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

REM ---- pull latest code ----
echo 正在从 GitHub 拉取最新代码……
git pull
if errorlevel 1 (
  echo.
  echo [提示] 拉取失败，可能是网络问题，可稍后重试；本次仍会用现有代码启动。
)
echo.

REM ---- hand over to the launch script: install deps if needed + start ----
call "启动.bat"
