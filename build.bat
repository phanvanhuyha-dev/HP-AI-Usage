@echo off
rem Vo boc ASCII thuan. Toan bo logic va thong bao tieng Viet nam trong build.ps1,
rem vi cmd.exe doc tep batch theo byte offset nen chcp 65001 giua chung se lam hong tep.
cd /d "%~dp0"

rem Doi cu phap /force kieu Windows sang tham so -Force cua PowerShell.
set "ARGS="
if /i "%~1"=="/force" set "ARGS=-Force"
if /i "%~1"=="-force" set "ARGS=-Force"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %ARGS%
set "RC=%errorlevel%"
if not "%RC%"=="0" pause
exit /b %RC%
