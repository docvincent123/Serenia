param(
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [string]$InputFile,
    [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Setup.Common.ps1')
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
function Install-Package([string]$Id, [string]$Override = '') {
    Refresh-Path
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'Не знайдено winget. Встановіть App Installer або PostgreSQL 17 і Caddy вручну та повторіть налаштування.' }
    $packageArgs = @('install','--exact','--id',$Id,'--accept-package-agreements','--accept-source-agreements','--disable-interactivity')
    if ($Override) { $packageArgs += @('--override',$Override) }
    Invoke-SetupProcess -FilePath $winget.Source -Arguments $packageArgs -Sensitive | Out-Null
    Refresh-Path
}

if (-not (Test-Administrator)) { throw 'Запустіть інсталятор або налаштування SOLVIA від імені адміністратора.' }
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$serverExe = Join-Path $InstallDir 'SolviaServer.exe'
if (-not (Test-Path -LiteralPath $serverExe)) { throw 'SolviaServer.exe не знайдено. Запустіть повний інсталятор SOLVIA 2.0.' }
$programData = Join-Path $env:ProgramData 'QureMed\SOLVIA'
$localDir = Join-Path $programData 'local'
New-Item -ItemType Directory -Force $programData,$localDir | Out-Null
Protect-SetupPath -Path $programData -Container
$configPath = Join-Path $programData 'server.env'
$settings = Read-ServerSettings $configPath
$existingDatabase = $settings['SOLVIA_DATABASE_URL']
if ($existingDatabase -and $existingDatabase -match '\s+SOLVIA_') {
    throw 'Попередній server.env містить обʼєднані рядки. Збережіть копію та виправте кожен SOLVIA_параметр на окремому рядку. Дані PostgreSQL не змінено.'
}

$adminLogin = ''
$adminPassword = ''
$postgresAdminPassword = ''
if ($InputFile) {
    $inputValues = [IO.File]::ReadAllLines($InputFile)
    if ($inputValues.Count -ne 3) { throw 'Некоректні дані майстра встановлення.' }
    $adminLogin,$adminPassword,$postgresAdminPassword = $inputValues
    Remove-Item -LiteralPath $InputFile -Force
    $inputValues = $null
} elseif (-not $NonInteractive) {
    if (-not $existingDatabase -or $settings['SOLVIA_SETUP_PENDING'] -eq '1') {
        $adminLogin = Read-Host 'Логін першого адміністратора SOLVIA'
        $adminPassword = Get-PlainText (Read-Host 'Пароль SOLVIA (12–128 символів)' -AsSecureString)
        $confirm = Get-PlainText (Read-Host 'Повторіть пароль' -AsSecureString)
        if ($adminPassword -cne $confirm) { throw 'Паролі не співпадають.' }
        $confirm = $null
    }
}
if (-not $existingDatabase) {
    if ($adminLogin -notmatch '^[A-Za-z0-9._-]{3,64}$') { throw 'Логін: 3–64 латинські літери, цифри, крапка, дефіс або підкреслення.' }
    if ([Text.Encoding]::UTF8.GetByteCount($adminPassword) -lt 12 -or [Text.Encoding]::UTF8.GetByteCount($adminPassword) -gt 128 -or $adminPassword -match '[\r\n]') { throw 'Пароль SOLVIA: 12–128 байтів UTF-8, без перенесень рядка.' }
}

Write-Host 'SOLVIA 2.0 — перевірка PostgreSQL' -ForegroundColor Cyan
Refresh-Path
$postgresBin = Find-PostgresBin
$installedPostgres = $false
if (-not $postgresBin) {
    if ($existingDatabase) { throw 'Не знайдено PostgreSQL для наявної конфігурації. Перевірте встановлення PostgreSQL; база не буде створюватися повторно.' }
    $postgresAdminPassword = New-HexSecret 24
    Install-Package 'PostgreSQL.PostgreSQL.17' ('--mode unattended --unattendedmodeui none --superpassword ' + $postgresAdminPassword + ' --serverport 5432')
    $postgresBin = Find-PostgresBin
    if (-not $postgresBin) { throw 'PostgreSQL встановлено, але psql.exe не знайдено. Перезавантажте Windows і повторіть налаштування.' }
    $installedPostgres = $true
}
$env:PGCONNECT_TIMEOUT = '10'
$psql = Join-Path $postgresBin 'psql.exe'
if ($existingDatabase) {
    Write-Host 'Зберігаємо наявну базу, пароль БД та облікові записи SOLVIA.'
    try { Test-SolviaDatabase $psql $existingDatabase }
    catch {
        if ($settings['SOLVIA_SETUP_PENDING'] -ne '1' -or -not $postgresAdminPassword) { throw }
        Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue
        $env:PGPASSWORD = $postgresAdminPassword
        $recoveryArgs = @('-w','-X','-h','127.0.0.1','-p','5432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1')
        $dbExists = Invoke-SetupProcess $psql ($recoveryArgs + @('-tAc',"SELECT 1 FROM pg_database WHERE datname='solvia'")) -Sensitive
        if ($dbExists) { throw 'Existing SOLVIA database could not be opened. Check the saved database credentials.' }
        Invoke-SetupProcess (Join-Path $postgresBin 'createdb.exe') @('-w','-h','127.0.0.1','-p','5432','-U','postgres','-O','solvia','solvia') -Sensitive | Out-Null
    }

    $databaseUrl = $existingDatabase
} else {
    if (-not $postgresAdminPassword -and -not $NonInteractive) {
        $postgresAdminPassword = Get-PlainText (Read-Host 'Пароль існуючого користувача PostgreSQL postgres' -AsSecureString)
    }
    if (-not $postgresAdminPassword) { throw 'PostgreSQL уже є на ПК. Вкажіть пароль користувача postgres на сторінці майстра встановлення.' }
    $env:PGPASSWORD = $postgresAdminPassword
    $pgArgs = @('-w','-X','-h','127.0.0.1','-p','5432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1')
    Invoke-SetupProcess $psql ($pgArgs + @('-tAc','SELECT 1')) -Sensitive | Out-Null
    $databasePassword = New-HexSecret 24
    $role = Invoke-SetupProcess $psql ($pgArgs + @('-tAc',"SELECT 1 FROM pg_roles WHERE rolname='solvia'")) -Sensitive
    # Do not rotate an existing database role without its saved configuration.
    if ($role) { throw 'Користувач БД solvia вже існує, але server.env відсутній. Відновіть конфігурацію з копії, щоб зберегти пароль і доступ до даних.' }
    Invoke-SetupProcess $psql ($pgArgs + @('-c',"CREATE ROLE solvia LOGIN PASSWORD '$databasePassword'")) -Sensitive | Out-Null
    $databaseUrl = 'postgresql://solvia:' + $databasePassword + '@127.0.0.1:5432/solvia'
    # Save credentials immediately so a retry after a later failure keeps this same role.
    $settings['SOLVIA_DATABASE_URL'] = $databaseUrl
    $settings['SOLVIA_SETUP_PENDING'] = '1'
    Write-ServerSettings $configPath $settings
    Protect-SetupPath $configPath
    Invoke-SetupProcess (Join-Path $postgresBin 'createdb.exe') @('-w','-h','127.0.0.1','-p','5432','-U','postgres','-O','solvia','solvia') -Sensitive | Out-Null
    if ($installedPostgres) {
        Invoke-SetupProcess $psql ($pgArgs + @('-c',"ALTER SYSTEM SET listen_addresses TO 'localhost'")) -Sensitive | Out-Null
        $service = Get-Service -Name 'postgresql*' | Where-Object { $_.Name -match '17' } | Select-Object -First 1
        if ($service) { Restart-Service $service.Name; $service.WaitForStatus('Running',[TimeSpan]::FromSeconds(45)) }
    }
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
$postgresAdminPassword = $null

Test-SolviaDatabase $psql $databaseUrl

Write-Host 'SOLVIA 2.0 — ініціалізація сервера' -ForegroundColor Cyan
$env:SOLVIA_DATABASE_URL = $databaseUrl
$env:SOLVIA_ADMIN_LOGIN = $adminLogin
$env:SOLVIA_ADMIN_PASSWORD = $adminPassword
$env:SOLVIA_ADMIN_NAME = 'Адміністратор'
try { Invoke-SetupProcess $serverExe @('--init','--ui',(Join-Path $InstallDir 'ui')) -Sensitive -DiagnosticErrors | Out-Null }
finally {
    foreach ($key in @('SOLVIA_ADMIN_LOGIN','SOLVIA_ADMIN_PASSWORD','SOLVIA_ADMIN_NAME','SOLVIA_DATABASE_URL')) { [Environment]::SetEnvironmentVariable($key,$null,'Process') }
    $adminPassword = $null
}

Write-Host 'SOLVIA 2.0 — локальний HTTPS' -ForegroundColor Cyan
Refresh-Path
$caddy = Get-Command caddy.exe -ErrorAction SilentlyContinue
$stableCaddy = Join-Path $InstallDir 'bin\caddy.exe'
if (-not (Test-Path -LiteralPath $stableCaddy)) {
    if (-not $caddy) { Install-Package 'CaddyServer.Caddy'; $caddy = Get-Command caddy.exe -ErrorAction Stop }
    New-Item -ItemType Directory -Force (Split-Path $stableCaddy) | Out-Null
    Copy-Item -LiteralPath $caddy.Source -Destination $stableCaddy -Force
}
$serverIp = Get-ServerIp
$settings['SOLVIA_DATABASE_URL'] = $databaseUrl
$settings['SOLVIA_SERVER_IP'] = $serverIp
$settings['SOLVIA_API_PORT'] = '8765'
$settings['SOLVIA_HTTPS_PORT'] = '8443'
$settings['SOLVIA_INSTALL_DIR'] = $InstallDir
$settings['SOLVIA_CADDY_EXE'] = $stableCaddy
$settings['SOLVIA_VERSION'] = '2.0.0'
$settings['SOLVIA_SETUP_PENDING'] = '1'
Write-ServerSettings $configPath $settings
Protect-SetupPath $configPath
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
https://$serverIp`:8443 {
    tls internal
    encode gzip
    reverse_proxy 127.0.0.1:8765
}
"@
[IO.File]::WriteAllText($caddyConfigPath,$caddyConfig,[Text.UTF8Encoding]::new($false))
Invoke-SetupProcess $stableCaddy @('validate','--config',$caddyConfigPath,'--adapter','caddyfile') | Out-Null

Get-NetFirewallRule -DisplayName 'SOLVIA Local HTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'SOLVIA Local HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -RemoteAddress LocalSubnet -Profile Private | Out-Null
$runScript = Join-Path $InstallDir 'installer\Run-Server.ps1'
$argument = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runScript + '" -InstallDir "' + $InstallDir + '"'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'SOLVIA Local Server' -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Force | Out-Null
Start-ScheduledTask -TaskName 'SOLVIA Local Server'

$rootCertCandidates = @(
    (Join-Path $localDir 'caddy-data\pki\authorities\local\root.crt'),
    (Join-Path $localDir 'caddy-data\caddy\pki\authorities\local\root.crt')
)
$rootCert = $null
$apiErrorLog = Join-Path $programData 'api-error.log'
$serverLog = Join-Path $programData 'server.log'
$ready = $false
$lastHealthError = ''
$lastState = ''

# First Caddy start can take longer while the local CA is generated.
for ($i=0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 750

    $listener = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        $lastState = 'API listener 8765 not ready'
        $taskInfo = Get-ScheduledTaskInfo -TaskName 'SOLVIA Local Server' -ErrorAction SilentlyContinue
        if ($taskInfo -and $taskInfo.LastTaskResult -ne 0 -and $taskInfo.LastTaskResult -ne 267009) {
            break
        }
        continue
    }

    try {
        $responseText = & curl.exe --noproxy '*' --silent --show-error --max-time 2 'http://127.0.0.1:8765/api/health'
        if ($LASTEXITCODE -eq 0 -and $responseText) {
            $response = $responseText | ConvertFrom-Json
            $httpsListener = Get-NetTCPConnection -State Listen -LocalPort 8443 -ErrorAction SilentlyContinue | Select-Object -First 1
            $rootCert = $rootCertCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

            if ($response.ok -and $response.version -eq '2.0.0' -and $httpsListener -and $rootCert) {
                $ready = $true
                break
            }

            $lastState = 'health=' + [string]$response.ok +
                '; version=' + [string]$response.version +
                '; https8443=' + [string][bool]$httpsListener +
                '; rootCert=' + [string][bool]$rootCert
        }
    } catch {
        $lastHealthError = $_.Exception.Message
    }
}
if (-not $ready) {
    $details = @()
    $taskInfo = Get-ScheduledTaskInfo -TaskName 'SOLVIA Local Server' -ErrorAction SilentlyContinue
    if ($taskInfo) { $details += ('ScheduledTask LastTaskResult=' + $taskInfo.LastTaskResult) }
    if ($lastState) { $details += ('Startup state: ' + $lastState) }
    if (Test-Path $apiErrorLog) {
        $apiTail = (Get-Content $apiErrorLog -Encoding UTF8 -Tail 12 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
        if ($apiTail) { $details += ('api-error.log:' + [Environment]::NewLine + $apiTail) }
    }
    if (Test-Path $serverLog) {
        $serverTail = (Get-Content $serverLog -Encoding UTF8 -Tail 12 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
        if ($serverTail) { $details += ('server.log:' + [Environment]::NewLine + $serverTail) }
    }
    if ($lastHealthError) { $details += ('Health check: ' + $lastHealthError) }
    throw ('SOLVIA 2.0 не запустила локальний API/HTTPS.' + [Environment]::NewLine + ($details -join [Environment]::NewLine))
}
if (-not $rootCert) {
    $rootCert = $rootCertCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $rootCert) { throw 'HTTPS запущено, але сертифікат центру ще не знайдено. Повторіть налаштування.' }
Copy-Item $rootCert (Join-Path $InstallDir 'QureMed-Local-CA.crt') -Force
$settings['SOLVIA_SETUP_PENDING'] = '0'
Write-ServerSettings $configPath $settings
Protect-SetupPath $configPath
Write-Host ('SOLVIA 2.0 готова. Адреса для телефонів: https://' + $serverIp + ':8443') -ForegroundColor Green
