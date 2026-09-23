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

try {
    $settings = Read-Settings
    $uri = [Uri]$settings['SOLVIA_DATABASE_URL']
    if (-not $uri -or $uri.Scheme -ne 'postgresql') { throw 'Invalid SOLVIA_DATABASE_URL.' }
    $parts = $uri.UserInfo.Split(':',2)
    $dbUser = $parts[0]
    $dbPassword = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    $dbName = $uri.AbsolutePath.TrimStart('/')
    $dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    $pgDump = Find-PgTool 'pg_dump'

    $backupDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'SOLVIA Backups'
    New-Item -ItemType Directory -Force $backupDir | Out-Null
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.InitialDirectory = $backupDir
    $dialog.Filter = 'SOLVIA backup (*.backup)|*.backup'
    $dialog.FileName = 'solvia_backup_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm') + '.backup'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }

    $env:PGPASSWORD = $dbPassword
    & $pgDump -Fc --no-owner --no-acl -h $uri.Host -p $dbPort -U $dbUser -d $dbName -f $dialog.FileName
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with code $LASTEXITCODE" }
    [System.Windows.Forms.MessageBox]::Show("Резервну копію створено:
$($dialog.FileName)",'SOLVIA Backup','OK','Information') | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'SOLVIA Backup','OK','Error') | Out-Null
    exit 1
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
