@echo off
chcp 65001 >nul
title Cài đặt biểu tượng HP-AI-Usage lên Desktop

echo ============================================================
echo   Đang tạo biểu tượng HP-AI-Usage trên Desktop...
echo ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cai-dat-shortcut-desktop.ps1"

echo.
echo Hoàn tất! Biểu tượng HP-AI-Usage đã xuất hiện trên Desktop của bạn.
timeout /t 3 >nul
