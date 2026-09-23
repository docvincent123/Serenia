param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function New-HexSecret([int]$byteCount = 32) {
    $bytes = New-Object byte[] $byteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
function Get-PlainText([Security.SecureString]$secure) {
    $credential = [Management.Automation.PSCredential]::new('value', $secure)
    return $credential.GetNetworkCredential().Password
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
function Find-PostgresBin {
    $command = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($command) { return Split-Path $command.Source }
    $roots = @((Join-Path $env:ProgramFiles 'PostgreSQL'), (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'PostgreSQL'))
    foreach ($root in $roots) {
        if (-not $root -or -not (Test-Path $root)) { continue }
        $bin = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
            ForEach-Object { Join-Path $_.FullName 'bin' } |
            Where-Object { Test-Path (Join-Path $_ 'psql.exe') } |
            Select-Object -First 1
        if ($bin) { return $bin }
    }
    return $null
}
function Get-ServerIp {
    $candidates = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object {
            $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' -and
            $_.IPv4DefaultGateway -and $_.IPv4Address -and
            $_.InterfaceAlias -notmatch 'Docker|WSL|Virtual|Bluetooth|Loopback|Hyper-V'
        } |
        ForEach-Object {
            foreach ($address in $_.IPv4Address) {
                if ($address.IPAddress -notlike '127.*' -and $address.IPAddress -notlike '169.254.*') {
                    [pscustomobject]@{ IP=$address.IPAddress; Metric=$_.NetAdapter.InterfaceMetric; Alias=$_.InterfaceAlias }
                }
            }
        } |
        Sort-Object Metric, @{Expression={ if ($_.Alias -match 'Wi-Fi|Wireless') { 0 } else { 1 } }}

    $ip = $candidates | Select-Object -First 1 -ExpandProperty IP
    if (-not $ip) {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'Docker|WSL|Virtual|Bluetooth|Loopback|Hyper-V' } |
            Sort-Object InterfaceMetric |
            Select-Object -First 1 -ExpandProperty IPAddress
    }
    if (-not $ip) { throw 'Не вдалося автоматично визначити IPv4 серверного ПК. Підключіть ПК до Wi-Fi/Ethernet центру та повторіть встановлення.' }
    return $ip
}
function Protect-Path([string]$path, [switch]$Container) {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ($Container) {
        & icacls.exe $path /inheritance:r /grant:r "$($currentUser):(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
    } else {
        & icacls.exe $path /inheritance:r /grant:r "$($currentUser):(F)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { throw "Не вдалося захистити $path" }
}

if (-not (Test-Administrator)) { throw 'Інсталятор SOLVIA потрібно запускати від імені адміністратора.' }
if (-not (Test-Path (Join-Path $InstallDir 'SolviaServer.exe'))) { throw 'SolviaServer.exe не знайдено у папці встановлення.' }
if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Потрібен Windows Package Manager (winget / App Installer).' }

$programData = Join-Path $env:ProgramData 'QureMed\SOLVIA'
$localDir = Join-Path $programData 'local'
New-Item -ItemType Directory -Force $programData, $localDir | Out-Null
Protect-Path $programData -Container

Write-Host ''
Write-Host 'SOLVIA by QureMed — налаштування серверного ПК' -ForegroundColor Cyan
Write-Host 'PostgreSQL буде доступний тільки на цьому комп’ютері. Телефони працюватимуть через HTTPS API.'
Write-Host ''

Refresh-Path
$postgresBin = Find-PostgresBin
$postgresAdminPassword = $null
if (-not $postgresBin) {
    Write-Host 'Встановлюємо PostgreSQL 17...'
    $postgresAdminPassword = New-HexSecret 24
    $override = '--mode unattended --unattendedmodeui none --superpassword ' + $postgresAdminPassword + ' --serverport 5432'
    & winget.exe install --exact --id PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements --disable-interactivity --override $override
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL installation failed: $LASTEXITCODE" }
    Refresh-Path
    $postgresBin = Find-PostgresBin
    if (-not $postgresBin) { throw 'PostgreSQL встановлено, але psql.exe не знайдено. Перезавантажте Windows і повторіть інсталяцію.' }
} else {
    Write-Host 'PostgreSQL уже встановлений.' -ForegroundColor Green
    $postgresAdminPassword = Get-PlainText (Read-Host 'Введіть пароль існуючого користувача PostgreSQL postgres' -AsSecureString)
}

$service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($service -and $service.Status -ne 'Running') {
    Start-Service $service.Name
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
}

$psql = Join-Path $postgresBin 'psql.exe'
$createdb = Join-Path $postgresBin 'createdb.exe'
$databasePassword = New-HexSecret 24
$env:PGPASSWORD = $postgresAdminPassword
try {
    & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc 'SELECT 1' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Не вдалося підключитися до PostgreSQL. Перевірте пароль postgres.' }

    $role = & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='solvia'"
    if ([string]::IsNullOrWhiteSpace(($role | Out-String))) {
        & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE solvia LOGIN PASSWORD '$databasePassword'" *> $null
    } else {
        & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE solvia WITH LOGIN PASSWORD '$databasePassword'" *> $null
    }
    if ($LASTEXITCODE -ne 0) { throw 'Не вдалося створити користувача БД SOLVIA.' }

    $db = & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='solvia'"
    if ([string]::IsNullOrWhiteSpace(($db | Out-String))) {
        & $createdb -h 127.0.0.1 -p 5432 -U postgres -O solvia solvia
        if ($LASTEXITCODE -ne 0) { throw 'Не вдалося створити базу solvia.' }
    } else {
        & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'ALTER DATABASE solvia OWNER TO solvia' *> $null
    }

    & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET listen_addresses TO 'localhost'" *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Не вдалося обмежити PostgreSQL локальним комп’ютером.' }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $postgresAdminPassword = $null
}

if ($service) {
    Restart-Service $service.Name -Force
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
}

$serverIp = Get-ServerIp
Write-Host ("LAN IP серверного ПК: " + $serverIp) -ForegroundColor Green

$adminSecure = Read-Host 'Створіть пароль адміністратора SOLVIA (мінімум 12 символів)' -AsSecureString
$adminPassword = Get-PlainText $adminSecure
if ($adminPassword.Length -lt 12 -or $adminPassword.Length -gt 128 -or $adminPassword -match "[\r\n]") {
    throw 'Пароль адміністратора повинен містити 12–128 символів.'
}

$configPath = Join-Path $programData 'server.env'
$databaseUrl = 'postgresql://solvia:' + $databasePassword + '@127.0.0.1:5432/solvia'
$config = @(
    'SOLVIA_DATABASE_URL=' + $databaseUrl,
    'SOLVIA_SERVER_IP=' + $serverIp,
    'SOLVIA_API_PORT=8765',
    'SOLVIA_INSTALL_DIR=' + $InstallDir
)
[IO.File]::WriteAllLines($configPath, $config, [Text.UTF8Encoding]::new($false))
Protect-Path $configPath

$env:SOLVIA_DATABASE_URL = $databaseUrl
$env:SOLVIA_ADMIN_PASSWORD = $adminPassword
$env:SOLVIA_ADMIN_NAME = 'Адміністратор'
try {
    & (Join-Path $InstallDir 'SolviaServer.exe') --init --ui (Join-Path $InstallDir 'ui')
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'База вже могла бути ініціалізована раніше. Перевіряємо запуск сервера...' -ForegroundColor Yellow
    }
} finally {
    Remove-Item Env:SOLVIA_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:SOLVIA_ADMIN_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:SOLVIA_DATABASE_URL -ErrorAction SilentlyContinue
    $adminPassword = $null
}

Refresh-Path
$caddy = Get-Command caddy.exe -ErrorAction SilentlyContinue
if (-not $caddy) {
    Write-Host 'Встановлюємо локальний HTTPS (Caddy)...'
    & winget.exe install --exact --id CaddyServer.Caddy --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw 'Не вдалося встановити Caddy.' }
    Refresh-Path
    $caddy = Get-Command caddy.exe -ErrorAction Stop
}

$settingsLines = [System.Collections.Generic.List[string]]::new()
$settingsLines.AddRange([string[]][IO.File]::ReadAllLines($configPath))
$settingsLines.Add('SOLVIA_CADDY_EXE=' + $caddy.Source)
[IO.File]::WriteAllLines($configPath, $settingsLines, [Text.UTF8Encoding]::new($false))
Protect-Path $configPath

$caddyData = (Join-Path $localDir 'caddy-data').Replace('\','/')
$caddyConfigPath = Join-Path $localDir 'Caddyfile'
$caddyConfig = @"
{
    admin off
    auto_https disable_redirects
    storage file_system {
        root "$caddyData"
    }
}
https://$serverIp {
    tls internal
    encode gzip
    reverse_proxy 127.0.0.1:8765
}
"@
[IO.File]::WriteAllText($caddyConfigPath, $caddyConfig, [Text.UTF8Encoding]::new($false))
& $caddy.Source validate --config $caddyConfigPath --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Помилка конфігурації локального HTTPS.' }

Get-NetFirewallRule -DisplayName 'SOLVIA Local HTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'SOLVIA Local HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress LocalSubnet -Profile Private | Out-Null

$runScript = Join-Path $InstallDir 'installer\Run-Server.ps1'
$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runScript + '" -InstallDir "' + $InstallDir + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'SOLVIA Local Server' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'SOLVIA Local Server'

$rootCert = Join-Path $localDir 'caddy-data\caddy\pki\authorities\local\root.crt'
for ($i=0; $i -lt 30 -and -not (Test-Path $rootCert); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $rootCert) {
    Copy-Item $rootCert (Join-Path $InstallDir 'QureMed-Local-CA.crt') -Force
}

Write-Host ''
Write-Host 'SOLVIA встановлено.' -ForegroundColor Green
Write-Host ('Сервер для телефонів: https://' + $serverIp) -ForegroundColor Green
Write-Host 'Логін адміністратора: admin' -ForegroundColor Green
Write-Host 'Пароль адміністратора: той, який ви щойно задали.' -ForegroundColor Green
Write-Host ''
Write-Host 'Для Android встановіть QureMed-Local-CA.crt як довірений CA-сертифікат, а у застосунку введіть адресу сервера вище.'
