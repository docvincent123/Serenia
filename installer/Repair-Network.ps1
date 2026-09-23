param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'

$programData = Join-Path $env:ProgramData 'QureMed\SOLVIA'
$configPath = Join-Path $programData 'server.env'
if (-not (Test-Path $configPath)) { throw 'SOLVIA server is not installed.' }

$candidates = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.InterfaceAlias -notmatch 'Docker|WSL|Virtual|Bluetooth|Loopback|Hyper-V' } |
    ForEach-Object { $_.IPv4Address | ForEach-Object { $_.IPAddress } } |
    Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' }
$ip = $candidates | Select-Object -First 1
if (-not $ip) { throw 'No LAN IPv4 found.' }

$settings = [ordered]@{}
foreach ($line in [IO.File]::ReadAllLines($configPath)) {
    $i=$line.IndexOf('=')
    if ($i -gt 0) { $settings[$line.Substring(0,$i)]=$line.Substring($i+1) }
}
$settings['SOLVIA_SERVER_IP']=$ip
$httpsPort = if ($settings['SOLVIA_HTTPS_PORT']) { $settings['SOLVIA_HTTPS_PORT'] } else { '8443' }
$settings['SOLVIA_HTTPS_PORT']=$httpsPort
[IO.File]::WriteAllLines($configPath,@($settings.GetEnumerator()|ForEach-Object{$_.Key+'='+$_.Value}),[Text.UTF8Encoding]::new($false))

$localDir=Join-Path $programData 'local'
$caddyData=(Join-Path $localDir 'caddy-data').Replace('\','/')
$caddyConfig=@"
{
    admin off
    auto_https disable_redirects
    storage file_system {
        root "$caddyData"
    }
}
https://$ip`:$httpsPort {
    tls internal
    encode gzip
    reverse_proxy 127.0.0.1:8765
}
"@
[IO.File]::WriteAllText((Join-Path $localDir 'Caddyfile'),$caddyConfig,[Text.UTF8Encoding]::new($false))
$caddyPidPath = Join-Path $localDir 'caddy.pid'
if (Test-Path $caddyPidPath) {
    $oldPid = [int](Get-Content $caddyPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid -gt 0) {
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $caddyPidPath -Force -ErrorAction SilentlyContinue
}
& (Join-Path $InstallDir 'installer\Run-Server.ps1') -InstallDir $InstallDir
Write-Host ('Нова адреса SOLVIA: https://' + $ip + ':' + $httpsPort) -ForegroundColor Green

