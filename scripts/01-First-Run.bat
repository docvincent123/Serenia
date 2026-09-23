@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo SOLVIA - Create administrator. Save the displayed password.
SolviaServer.exe --init
pause
