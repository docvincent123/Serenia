@echo off
setlocal
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-Setup.ps1" -InstallDir "%~dp0.."
if errorlevel 1 (
  echo SOLVIA setup failed. Log: %ProgramData%\QureMed\SOLVIA\install.log
  pause
)
