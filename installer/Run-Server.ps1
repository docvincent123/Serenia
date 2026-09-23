param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'

try {
$logDir = Join-Path $env:ProgramData 'QureMed\SOLVIA'
Start-Transcript -Path (Join-Path $logDir 'server.log') -Append | Out-Null
$configPath = Join-Path $env:ProgramData 'QureMed\SOLVIA\server.env'
if (-not (Test-Path $configPath)) { throw 'Server configuration not found' }

$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($configPath)) {
    $i = $line.IndexOf('=')
    if ($i -gt 0) { $settings[$line.Substring(0,$i)] = $line.Substring($i+1) }
}

$databaseUrl = $settings['SOLVIA_DATABASE_URL']
$serverIp = $settings['SOLVIA_SERVER_IP']
$port = if ($settings['SOLVIA_API_PORT']) { $settings['SOLVIA_API_PORT'] } else { '8765' }
$httpsPort = if ($settings['SOLVIA_HTTPS_PORT']) { $settings['SOLVIA_HTTPS_PORT'] } else { '8443' }
if (-not $databaseUrl -or -not $serverIp) { throw 'Incomplete server configuration' }

$env:SOLVIA_DATABASE_URL = $databaseUrl
$serverExe = Join-Path $InstallDir 'SolviaServer.exe'
$uiDir = Join-Path $InstallDir 'ui'

$existing = Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    $owner = Get-Process -Id $existing.OwningProcess -ErrorAction Stop
    if ($owner.Path -ne $serverExe) { throw 'API port is occupied by another application.' }
    Stop-Process -Id $owner.Id -Force
    $owner.WaitForExit(10000) | Out-Null
}
$args = @('--host','127.0.0.1','--port',$port,'--ui',('"' + $uiDir + '"'))
$serverProcess = Start-Process -FilePath $serverExe -ArgumentList $args -WorkingDirectory $InstallDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'api-output.log') -RedirectStandardError (Join-Path $logDir 'api-error.log')

$healthy = $false
for ($i=0; $i -lt 40; $i++) {
    try {
        $response = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 2
        if ($response.ok -and $response.version -eq '2.0.0') { $healthy = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
    if ($serverProcess.HasExited) { throw ('SOLVIA API exited with code ' + $serverProcess.ExitCode + '. Check api-error.log.') }
    throw 'SOLVIA API did not become healthy on localhost.'
}

for ($i=0; $i -lt 60; $i++) {
    if (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $serverIp -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Seconds 1
}

$caddyPath = $settings['SOLVIA_CADDY_EXE']
if (-not $caddyPath -or -not (Test-Path $caddyPath)) {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    $caddyCommand = Get-Command caddy.exe -ErrorAction SilentlyContinue
    $caddyPath = if ($caddyCommand) { $caddyCommand.Source } else { $null }
}
$caddyConfig = Join-Path $env:ProgramData 'QureMed\SOLVIA\local\Caddyfile'
$caddyPidPath = Join-Path $env:ProgramData 'QureMed\SOLVIA\local\caddy.pid'
$https = Get-NetTCPConnection -State Listen -LocalPort ([int]$httpsPort) -ErrorAction SilentlyContinue | Select-Object -First 1
if ($https) {
    $owner = Get-Process -Id $https.OwningProcess -ErrorAction Stop
    if ($owner.Path -ne $caddyPath) { throw 'HTTPS port is occupied by another application.' }
    Stop-Process -Id $owner.Id -Force
    $owner.WaitForExit(10000) | Out-Null
    $https = $null
}
if ($caddyPath -and (Test-Path $caddyConfig) -and -not $https) {
    $caddyProcess = Start-Process -FilePath $caddyPath -ArgumentList @('run','--config',('"' + $caddyConfig + '"'),'--adapter','caddyfile') -WorkingDirectory (Split-Path $caddyConfig) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'https-output.log') -RedirectStandardError (Join-Path $logDir 'https-error.log')
    [IO.File]::WriteAllText($caddyPidPath, [string]$caddyProcess.Id)
} elseif ($https) {
    $caddyProcess = Get-Process -Id $https.OwningProcess -ErrorAction Stop
}

# Keep the scheduled task alive. On some Windows systems child processes launched
# from a scheduled task are terminated when the task host exits.
Write-Host ('SOLVIA supervisor active. API PID=' + $serverProcess.Id + '; Caddy PID=' + $caddyProcess.Id)
while ($true) {
    Start-Sleep -Seconds 5
    if ($serverProcess.HasExited) {
        throw ('SolviaServer.exe stopped unexpectedly with code ' + $serverProcess.ExitCode + '. Check api-error.log.')
    }
    if ($caddyProcess.HasExited) {
        throw ('Caddy stopped unexpectedly with code ' + $caddyProcess.ExitCode + '. Check https-error.log.')
    }
}


} catch {
    Write-Host ("SOLVIA startup failed: " + $_.Exception.Message)
    exit 1
} finally {
    Remove-Item Env:SOLVIA_DATABASE_URL -ErrorAction SilentlyContinue
    try { Stop-Transcript | Out-Null } catch {}
}
