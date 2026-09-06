@echo off
chcp 65001 >nul
title HP-AI-Usage Desktop Widget

echo ============================================================
echo   Đang khởi động HP-AI-Usage Desktop Widget (Ghim Trên Cùng)...
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0widget-desktop.ps1"

echo Hoàn tất khởi động tiện ích.
timeout /t 2 >nul
