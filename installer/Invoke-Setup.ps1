param(
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [string]$InputFile,
    [switch]$NonInteractive
)
# This launcher is ASCII so even parse failures in a child script remain visible.
$ErrorActionPreference = 'Stop'
$exitCode = 1
$logPath = Join-Path $env:TEMP 'SOLVIA-setup.log'
try {
    $logDir = Join-Path $env:ProgramData 'QureMed\SOLVIA'
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $logPath = Join-Path $logDir 'install.log'
    . (Join-Path $PSScriptRoot 'Setup.Common.ps1')
    Protect-SetupPath -Path $logDir -Container
    try { Start-Transcript -Path $logPath -Append -Force | Out-Null } catch {}
    & (Join-Path $PSScriptRoot 'Setup-Server.ps1') -InstallDir $InstallDir -InputFile $InputFile -NonInteractive:$NonInteractive
    $exitCode = 0
    Write-Host 'SOLVIA 1.1: server configuration completed.'
} catch {
    $message = 'SOLVIA setup failed: ' + $_.Exception.Message
    Write-Host $message -ForegroundColor Red
    try { Add-Content -LiteralPath $logPath -Value $message -Encoding UTF8 } catch {}
} finally {
    if ($InputFile -and (Test-Path -LiteralPath $InputFile)) { Remove-Item -LiteralPath $InputFile -Force -ErrorAction SilentlyContinue }
    foreach ($key in @('SOLVIA_ADMIN_LOGIN','SOLVIA_ADMIN_PASSWORD','SOLVIA_ADMIN_NAME','SOLVIA_DATABASE_URL','PGPASSWORD','PGCONNECT_TIMEOUT','PGDATABASE')) {
        [Environment]::SetEnvironmentVariable($key,$null,'Process')
    }
    try { Stop-Transcript | Out-Null } catch {}
}
Write-Host ('Log: ' + $logPath)
if (-not $NonInteractive) {
    try { Read-Host 'Press Enter to close this window' | Out-Null } catch {}
}
exit $exitCode
