# Shared helpers; compatible with Windows PowerShell 5.1.
function ConvertTo-ProcessArgument([string]$Value) {
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Invoke-SetupProcess {
    param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds = 900, [switch]$Sensitive, [switch]$DiagnosticErrors)
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $FilePath
    $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Cannot start setup dependency.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            throw ('Setup step timed out: ' + [IO.Path]::GetFileName($FilePath))
        }
        $process.WaitForExit()
        $output = $stdout.GetAwaiter().GetResult()
        $errors = $stderr.GetAwaiter().GetResult()
        # A native program can legitimately write progress to stderr (Caddy, winget).
        if (-not $Sensitive) {
            if ($output) { Write-Host $output.TrimEnd() }
            if ($errors) { Write-Host $errors.TrimEnd() }
        }
        if ($process.ExitCode -ne 0) {
            if ($DiagnosticErrors -and $errors) {
                $safeError = $errors
                foreach ($key in @('PGPASSWORD','SOLVIA_ADMIN_PASSWORD','SOLVIA_DATABASE_URL')) {
                    $secret = [Environment]::GetEnvironmentVariable($key,'Process')
                    if ($secret) { $safeError = $safeError.Replace($secret,'[redacted]') }
                }
                $safeError = [regex]::Replace($safeError, '(?i)(postgres(?:ql)?://[^:\s/]+:)[^@\s]+@', '$1[redacted]@')
                Write-Host $safeError.TrimEnd()
            }
            throw ('Setup step failed: {0}, exit code {1}.' -f [IO.Path]::GetFileName($FilePath), $process.ExitCode)
        }
        return $output.Trim()
    } finally { $process.Dispose() }
}
function Read-ServerSettings([string]$Path) {
    $settings = [ordered]@{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [IO.File]::ReadAllLines($Path)) {
            $index = $line.IndexOf('=')
            if ($index -gt 0) { $settings[$line.Substring(0,$index)] = $line.Substring($index+1) }
        }
    }
    return $settings
}
function Write-ServerSettings([string]$Path, [System.Collections.IDictionary]$Settings) {
    $lines = @($Settings.GetEnumerator() | ForEach-Object {
        if ([string]$_.Key -match '[=\r\n]' -or [string]$_.Value -match '[\r\n]') { throw 'Invalid server setting.' }
        '{0}={1}' -f $_.Key, $_.Value
    })
    # Keep an existing configuration in place until every new line has been written.
    $temporary = $Path + '.new'
    [IO.File]::WriteAllLines($temporary, [string[]]$lines, [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Path) {
        [IO.File]::Replace($temporary, $Path, [System.Management.Automation.Language.NullString]::Value)
    } else { [IO.File]::Move($temporary, $Path) }
}
function Protect-SetupPath([string]$Path, [switch]$Container) {
    $permissions = if ($Container) { '(OI)(CI)(F)' } else { '(F)' }
    Invoke-SetupProcess -FilePath "$env:SystemRoot\System32\icacls.exe" -Arguments @(
        $Path, '/inheritance:r', '/grant:r', ('*S-1-5-18:' + $permissions), ('*S-1-5-32-544:' + $permissions)
    ) | Out-Null
}

function Test-SolviaDatabase([string]$Psql, [string]$DatabaseUrl) {
    # Pass the URI without userinfo explicitly; keep its password out of argv/logs.
    $uri = [Uri]$DatabaseUrl
    $credentials = $uri.UserInfo -split ':',2
    if ($credentials.Count -ne 2) { throw 'Invalid saved database connection.' }
    $env:PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
    $publicUri = [regex]::Replace($DatabaseUrl, '^(postgres(?:ql)?://)[^@]+@', '$1')
    try {
        Invoke-SetupProcess $Psql @('-w','-X','-U',[Uri]::UnescapeDataString($credentials[0]),'-d',$publicUri,'-v','ON_ERROR_STOP=1','-tAc','SELECT 1') -Sensitive -DiagnosticErrors | Out-Null
    } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}


function Get-SolviaHealth([int]$Port = 8765) {
    # Probe the service itself; CIM listener enumeration can fail independently.
    $request = [Net.HttpWebRequest]::Create(('http://127.0.0.1:{0}/api/health' -f $Port))
    $request.Proxy = $null
    $request.Timeout = 2000
    $request.ReadWriteTimeout = 2000
    $request.AllowAutoRedirect = $false
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) { throw 'Health endpoint did not return HTTP 200.' }
        $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
        $health = $reader.ReadToEnd() | ConvertFrom-Json
        if ($health.ok -ne $true -or $health.version -ne '2.0.0') { throw ('Unexpected SOLVIA health/version: ' + [string]$health.version) }
        return $health
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Close() }
        $request.Abort()
    }
}
function Test-SolviaTcpPort([string]$Address, [int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.ConnectAsync($Address,$Port)
        if (-not $pending.Wait(1500)) { return $false }
        return $client.Connected
    } catch { return $false }
    finally { $client.Dispose() }
}

function New-SolviaTaskSettings {
    # Servers must start on laptops too; Task Scheduler defaults prohibit battery starts.
    New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
}
function Stop-SolviaInstallationProcesses([string]$InstallDir) {
    $root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    $ownedPaths = @((Join-Path $root 'SolviaServer.exe'), (Join-Path $root 'bin\caddy.exe'))
    # ExecutablePath also works when the installer host and child have different bitness.
    foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name = 'SolviaServer.exe' OR Name = 'caddy.exe'" -ErrorAction Stop)) {
        if ($candidate.ExecutablePath -and $ownedPaths -contains $candidate.ExecutablePath) {
            $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
            if (-not $process) { continue }
            Write-Host ('Stopping SOLVIA process PID=' + $process.Id)
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
            if (-not $process.WaitForExit(10000)) { throw 'Previous SOLVIA process did not stop.' }
        }
    }
}
function Stop-SolviaServer([string]$InstallDir) {
    $task = Get-ScheduledTask -TaskName 'SOLVIA Local Server' -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -TaskName 'SOLVIA Local Server' | Out-Null
        Stop-ScheduledTask -TaskName 'SOLVIA Local Server' -ErrorAction Stop
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            $task = Get-ScheduledTask -TaskName 'SOLVIA Local Server'
            if ($task.State -notin @('Running','Queued')) { break }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Previous SOLVIA scheduled task did not stop; restart Windows before retrying setup.' }
            Start-Sleep -Milliseconds 250
        } while ($true)
    }
    Stop-SolviaInstallationProcesses $InstallDir
}
