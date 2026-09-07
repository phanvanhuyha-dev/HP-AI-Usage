@echo off
chcp 65001 >nul
title HP-AI-Usage Dashboard

echo ============================================================
echo   Đang kiểm tra môi trường và khởi động HP-AI-Usage...
echo ============================================================
echo.

:: 1. Kiểm tra môi trường Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LỖI] Máy tính của bạn chưa cài đặt Node.js!
    echo.
    echo Ứng dụng HP-AI-Usage cần Node.js (phiên bản 18 trở lên) để chạy máy chủ nội bộ.
    echo Vui lòng tải và cài đặt Node.js bản LTS tại:
    echo   https://nodejs.org
    echo.
    echo Sau khi cài đặt xong Node.js, vui lòng chạy lại tệp start.bat này.
    echo ============================================================
    echo.
    pause
    exit /b 1
)

:: 2. Khởi chạy máy chủ và mở trình duyệt
echo   Địa chỉ màn hình tổng hợp: http://127.0.0.1:6736
echo   Nhấn Ctrl+C để dừng máy chủ.
echo.

start "" http://127.0.0.1:6736
node server.js

pause

