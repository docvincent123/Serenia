param([Parameter(Mandatory=$true)][string]$Setup)
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:TEMP ('SOLVIA client ' + [guid]::NewGuid())
$log = Join-Path $env:TEMP ('SOLVIA-client-install-' + [guid]::NewGuid() + '.log')
try {
    $process = Start-Process -FilePath (Resolve-Path $Setup).Path -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TYPE=client', '/COMPONENTS=client', ('/DIR="' + $target + '"'), ('/LOG="' + $log + '"')) -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw ('Client installer failed: ' + $process.ExitCode + '; log: ' + $log) }
    foreach ($name in @('Solvia.exe', 'ui/index.html', 'installer/Trust-Server-Certificate.ps1')) {
        if (!(Test-Path (Join-Path $target $name))) { throw ('Client payload missing ' + $name) }
    }
    foreach ($name in @('SolviaServer.exe', 'SolviaServerConsole.exe', 'installer/Invoke-Setup.ps1')) {
        if (Test-Path (Join-Path $target $name)) { throw ('Server payload installed in client mode: ' + $name) }
    }
    & "$PSScriptRoot/windows-ui.ps1" -BuildDir $target
    Write-Host 'Installed Windows client opens React without a local server'
} finally {
    if (Test-Path (Join-Path $target 'unins000.exe')) {
        Start-Process (Join-Path $target 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait | Out-Null
    }
    if (Test-Path $log) { Copy-Item $log 'out/ui/client-install.log' -Force }
}
