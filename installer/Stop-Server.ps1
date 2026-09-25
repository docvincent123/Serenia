param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'Setup.Common.ps1')
    Stop-SolviaServer $InstallDir
    exit 0
} catch {
    Write-Host ('Cannot stop previous SOLVIA server: ' + $_.Exception.Message)
    exit 1
}
