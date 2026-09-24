$ErrorActionPreference='Stop'
. "$PSScriptRoot/../installer/Setup.Common.ps1"
$settings = New-SolviaTaskSettings
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
