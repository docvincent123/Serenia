$ErrorActionPreference='Stop'
. "$PSScriptRoot/../installer/Setup.Common.ps1"
$settings = New-SolviaTaskSettings
$apiArgs = Get-SolviaApiProcessArguments -Port '8765' -UiDirectory 'C:\Program Files\QureMed\SOLVIA\ui'
$repair = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../installer/Repair-Network.ps1'))
$serverSetup = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../installer/Setup-Server.ps1'))
if ($repair -notmatch "preferred = 'https'" -or $serverSetup -notmatch "preferred = 'https'") { throw 'Mobile config must prefer HTTPS.' }
if ($repair -match '(?m)^New-NetFirewallRule.*8765' -or $serverSetup -match '(?m)^New-NetFirewallRule.*8765') { throw 'The raw HTTP API must not be opened in Windows Firewall.' }
if ($apiArgs[0] -ne '--host' -or $apiArgs[1] -ne '127.0.0.1' -or $apiArgs -contains '0.0.0.0') { throw 'SOLVIA HTTP API must only listen on loopback; Caddy exposes HTTPS to LAN.' }
if ($apiArgs[2] -ne '--port' -or $apiArgs[3] -ne '8765' -or $apiArgs[4] -ne '--ui' -or $apiArgs[5] -ne '"C:\Program Files\QureMed\SOLVIA\ui"') { throw 'API launch arguments are malformed.' }
if ($repair -match '(?m)^New-NetFirewallRule.*SOLVIA Local HTTP API' -or $repair -match '(?m)^.*http://.*:8765') { throw 'Network repair must only publish HTTPS.' }
if ($settings.DisallowStartIfOnBatteries -or $settings.StopIfGoingOnBatteries) { throw 'Server task is blocked on battery power' }
if (-not $settings.StartWhenAvailable -or [int]$settings.MultipleInstances -ne 2) { throw 'Incorrect startup/concurrency policy' }
$root = Join-Path $env:TEMP ('solvia-restart-' + [guid]::NewGuid())
$other = Join-Path $root 'another-installation'
New-Item -ItemType Directory -Force $root,$other | Out-Null
$owned = $null; $foreign = $null
try {
    $exe = Join-Path $root 'SolviaServer.exe'
    Add-Type -TypeDefinition 'public class SolviaRestartFixture { public static void Main() { System.Threading.Thread.Sleep(60000); } }' -OutputAssembly $exe -OutputType ConsoleApplication
    Copy-Item $exe (Join-Path $other 'SolviaServer.exe')
    $owned = Start-Process $exe -PassThru -WindowStyle Hidden
    $foreign = Start-Process (Join-Path $other 'SolviaServer.exe') -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 500
    Get-CimInstance Win32_Process -Filter "Name = 'SolviaServer.exe'" | Select-Object ProcessId,ExecutablePath | Format-Table | Out-Host
    Stop-SolviaInstallationProcesses $root
    $owned.Refresh(); $foreign.Refresh()
    if (-not $owned.HasExited) { throw 'Old server still running' }
    if ($foreign.HasExited) { throw 'Another installation was incorrectly stopped' }
    Write-Host 'Task power settings and installation-scoped restart checks passed.'
} finally {
    foreach ($process in @($owned,$foreign)) {
        if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force; $process.WaitForExit(10000) | Out-Null }
    }
    Remove-Item $root -Recurse -Force
}

