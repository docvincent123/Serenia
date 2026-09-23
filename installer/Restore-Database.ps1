param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

function Read-Settings {
    $path = Join-Path $env:ProgramData 'QureMed\SOLVIA\server.env'
    if (-not (Test-Path $path)) { throw 'SOLVIA server.env not found.' }
    $settings = @{}
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        $i = $line.IndexOf('=')
        if ($i -gt 0) { $settings[$line.Substring(0,$i)] = $line.Substring($i+1) }
    }
    return $settings
}
function Find-PgTool([string]$name) {
    $cmd = Get-Command ($name + '.exe') -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $root = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path $root) {
        $tool = Get-ChildItem $root -Directory | Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
            ForEach-Object { Join-Path $_.FullName ('bin\' + $name + '.exe') } |
            Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($tool) { return $tool }
    }
    throw "$name.exe not found."
}

$taskStopped = $false
try {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = 'SOLVIA backup (*.backup)|*.backup'
    $dialog.Title = 'Оберіть резервну копію SOLVIA'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }

    $answer = [System.Windows.Forms.MessageBox]::Show(
        'Відновлення замінить поточні дані SOLVIA даними з резервної копії. RehaFlow не буде змінено. Продовжити?',
        'SOLVIA Restore',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }

    $settings = Read-Settings
    $uri = [Uri]$settings['SOLVIA_DATABASE_URL']
    $parts = $uri.UserInfo.Split(':',2)
    $dbUser = $parts[0]
    $dbPassword = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    $dbName = $uri.AbsolutePath.TrimStart('/')
    if ($dbName -ne 'solvia') { throw 'Restore is restricted to the SOLVIA database.' }
    $dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    $pgRestore = Find-PgTool 'pg_restore'

    Stop-ScheduledTask -TaskName 'SOLVIA Local Server' -ErrorAction SilentlyContinue
    $taskStopped = $true
    Get-Process SolviaServer -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1

    $env:PGPASSWORD = $dbPassword
    & $pgRestore --clean --if-exists --no-owner --no-acl --exit-on-error -h $uri.Host -p $dbPort -U $dbUser -d $dbName $dialog.FileName
    if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with code $LASTEXITCODE" }

    Start-ScheduledTask -TaskName 'SOLVIA Local Server'
    $taskStopped = $false
    [System.Windows.Forms.MessageBox]::Show('Базу SOLVIA відновлено. Сервер запущено повторно.','SOLVIA Restore','OK','Information') | Out-Null
} catch {
    if ($taskStopped) { try { Start-ScheduledTask -TaskName 'SOLVIA Local Server' } catch {} }
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'SOLVIA Restore','OK','Error') | Out-Null
    exit 1
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
