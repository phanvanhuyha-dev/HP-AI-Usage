@echo off
chcp 65001 >nul
title Cài đặt biểu tượng HP-AI-Usage Widget lên Desktop

echo ============================================================
echo   Đang tạo biểu tượng HP-AI-Usage Widget trên Desktop...
echo ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cai-dat-shortcut-widget.ps1"

echo.
echo Hoàn tất! Biểu tượng HP-AI-Usage Widget đã xuất hiện trên Desktop.
timeout /t 3 >nul
