$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../installer/Setup.Common.ps1"
$testDir = Join-Path $env:TEMP ('solvia installer ' + [guid]::NewGuid())
New-Item -ItemType Directory $testDir | Out-Null
try {
    Get-ChildItem "$PSScriptRoot/../installer/*.ps1" | ForEach-Object {
        $bytes = [IO.File]::ReadAllBytes($_.FullName)
        if ($bytes[0] -ne 239 -or $bytes[1] -ne 187 -or $bytes[2] -ne 191) { throw ('Missing UTF-8 BOM: ' + $_.Name) }
    }
    $config = Join-Path $testDir 'server.env'
    $settings = [ordered]@{ SOLVIA_DATABASE_URL='postgresql://user:password@localhost/solvia?sslmode=prefer'; SOLVIA_INSTALL_DIR='C:\Program Files\QureMed\SOLVIA'; SOLVIA_API_PORT='8765' }
    Write-ServerSettings $config $settings
    $read = Read-ServerSettings $config
    if ($read.Count -ne 3 -or $read['SOLVIA_DATABASE_URL'] -cne $settings['SOLVIA_DATABASE_URL']) { throw 'Configuration roundtrip failed' }
    $settings['SOLVIA_API_PORT'] = '9999'
    Write-ServerSettings $config $settings
    if ((Read-ServerSettings $config)['SOLVIA_API_PORT'] -ne '9999') { throw 'Configuration replacement failed' }
    $exe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $native = Join-Path $testDir 'native.ps1'
    Set-Content $native 'param([string]$Value) [Console]::Error.WriteLine("progress"); [Console]::Out.Write($Value); exit 0' -Encoding UTF8
    foreach ($value in @('path with spaces','C:\trailing\','a"b','a\"b')) {
        $output = Invoke-SetupProcess $exe @('-NoProfile','-File',$native,'-Value',$value) -Sensitive
        if ($output -cne $value) { throw ('Native argument roundtrip failed: ' + $value) }
    }
    Set-Content $native 'exit 7' -Encoding UTF8
    $failed = $false
    try { Invoke-SetupProcess $exe @('-NoProfile','-File',$native) } catch { $failed = $_.Exception.Message -match 'exit code 7' }
    if (-not $failed) { throw 'Native failure was not propagated' }
    # A parse error in the child must be caught by the bootstrap before the window closes.
    Copy-Item "$PSScriptRoot/../installer/Invoke-Setup.ps1" $testDir
    Set-Content (Join-Path $testDir 'Setup.Common.ps1') 'function Protect-SetupPath { param($Path,[switch]$Container) }' -Encoding UTF8
    Set-Content (Join-Path $testDir 'Setup-Server.ps1') 'function broken {' -Encoding UTF8
    $oldData = $env:ProgramData
    try {
        $env:ProgramData = $testDir
        $failed = $false
        try { Invoke-SetupProcess $exe @('-NoProfile','-File',(Join-Path $testDir 'Invoke-Setup.ps1'),'-InstallDir',$testDir,'-NonInteractive') } catch { $failed = $true }
        if (-not $failed) { throw 'Child parser failure returned success' }
        $log = Join-Path $testDir 'QureMed\SOLVIA\install.log'
        if (-not (Test-Path $log) -or (Get-Content $log -Raw) -notmatch 'SOLVIA setup failed') { throw 'Persistent error log missing' }
    } finally { $env:ProgramData = $oldData }
    Write-Host 'Installer regression tests passed on Windows PowerShell' $PSVersionTable.PSVersion
} finally { Remove-Item $testDir -Recurse -Force }
