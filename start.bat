@echo off
chcp 65001 >nul
title HP-AI-Usage Dashboard

echo ============================================================
echo   Đang khởi động HP-AI-Usage Dashboard...
echo ============================================================
echo.
echo   Địa chỉ bảng điều khiển: http://127.0.0.1:6736
echo   Nhấn Ctrl+C để dừng máy chủ.
echo.

start "" http://127.0.0.1:6736
node server.js

pause
