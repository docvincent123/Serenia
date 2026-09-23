@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo SOLVIA - Create four demo accounts. Save the displayed passwords.
SolviaServer.exe --demo
pause
