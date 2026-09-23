$ErrorActionPreference = 'Stop'
param([Parameter(Mandatory=$true)][string]$InstallDir)

$configPath = Join-Path $env:ProgramData 'QureMed\SOLVIA\server.env'
if (-not (Test-Path $configPath)) { exit 2 }

$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($configPath)) {
    $i = $line.IndexOf('=')
    if ($i -gt 0) { $settings[$line.Substring(0,$i)] = $line.Substring($i+1) }
}

$databaseUrl = $settings['SOLVIA_DATABASE_URL']
$serverIp = $settings['SOLVIA_SERVER_IP']
$port = if ($settings['SOLVIA_API_PORT']) { $settings['SOLVIA_API_PORT'] } else { '8765' }
if (-not $databaseUrl -or -not $serverIp) { exit 3 }

$env:SOLVIA_DATABASE_URL = $databaseUrl
$serverExe = Join-Path $InstallDir 'SolviaServer.exe'
$uiDir = Join-Path $InstallDir 'ui'

$existing = Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $existing) {
    $args = @('--host','127.0.0.1','--port',$port,'--ui',('"' + $uiDir + '"'))
    Start-Process -FilePath $serverExe -ArgumentList $args -WorkingDirectory $InstallDir -WindowStyle Hidden
}

for ($i=0; $i -lt 60; $i++) {
    if (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $serverIp -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Seconds 1
}

$caddy = Get-Command caddy.exe -ErrorAction SilentlyContinue
if (-not $caddy) {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    $caddy = Get-Command caddy.exe -ErrorAction SilentlyContinue
}
$caddyConfig = Join-Path $env:ProgramData 'QureMed\SOLVIA\local\Caddyfile'
$https = Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($caddy -and (Test-Path $caddyConfig) -and -not $https) {
    Start-Process -FilePath $caddy.Source -ArgumentList @('run','--config',('"' + $caddyConfig + '"'),'--adapter','caddyfile') -WorkingDirectory (Split-Path $caddyConfig) -WindowStyle Hidden
}
