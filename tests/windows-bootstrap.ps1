param([string]$BuildDir='build/Release')
$ErrorActionPreference='Stop'
. "$PSScriptRoot/../installer/Setup.Common.ps1"
$pg = Get-ChildItem 'C:/Program Files/PostgreSQL/*/bin/pg_ctl.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pg) { throw 'PostgreSQL binaries required for Windows bootstrap regression' }
$bin = $pg.DirectoryName
$root = Join-Path $env:TEMP ('solvia-pg-' + [guid]::NewGuid())
$data = Join-Path $root 'data'
New-Item -ItemType Directory $root | Out-Null
$started = $false
try {
    Invoke-SetupProcess (Join-Path $bin 'initdb.exe') @('-D',$data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C') -Sensitive | Out-Null
    # pg_ctl starts a persistent child. Do not give that child redirected pipes.
    $ctlArgs = @('-D',$data,'-l',(Join-Path $root 'postgres.log'),'-o','-h 127.0.0.1 -p 55439','-w','start')
    $ctl = Start-Process $pg.FullName -ArgumentList (($ctlArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ') -PassThru -WindowStyle Hidden
    if (-not $ctl.WaitForExit(60000) -or $ctl.ExitCode -ne 0) { throw 'Test PostgreSQL failed to start' }
    $started = $true
    $psql = Join-Path $bin 'psql.exe'
    $argsPg = @('-X','-h','127.0.0.1','-p','55439','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1')
    Invoke-SetupProcess $psql ($argsPg + @('-c',"CREATE ROLE solvia LOGIN PASSWORD 'test-db-secret'")) -Sensitive | Out-Null
    Invoke-SetupProcess $psql ($argsPg + @('-c','CREATE DATABASE solvia OWNER solvia')) -Sensitive | Out-Null
    # Require the saved credentials on all subsequent connections.
    [IO.File]::WriteAllText((Join-Path $data 'pg_hba.conf'),"host all all 127.0.0.1/32 scram-sha-256`r`n")
    Invoke-SetupProcess $pg.FullName @('-D',$data,'reload') -Sensitive | Out-Null
    $env:SOLVIA_DATABASE_URL='postgresql://solvia:test-db-secret@127.0.0.1:55439/solvia'
    Test-SolviaDatabase $psql $env:SOLVIA_DATABASE_URL
    $env:SOLVIA_ADMIN_LOGIN='bootstrap_admin'
    $env:SOLVIA_ADMIN_NAME='Адміністратор Олена'
    $env:SOLVIA_ADMIN_PASSWORD='НадійнийПароль-123'
    $server = (Resolve-Path (Join-Path $BuildDir 'SolviaServer.exe')).Path
    Invoke-SetupProcess $server @('--init') -Sensitive -DiagnosticErrors | Out-Null
    Remove-Item Env:SOLVIA_ADMIN_PASSWORD
    Invoke-SetupProcess $server @('--init') -Sensitive -DiagnosticErrors | Out-Null
    $env:PGPASSWORD='test-db-secret'
    $env:PGCLIENTENCODING='UTF8'
    # Compare hex in ASCII to avoid console output-codepage effects.
    $actual = Invoke-SetupProcess $psql @('-X','-h','127.0.0.1','-p','55439','-U','solvia','-d','solvia','-tAc',"SELECT encode(convert_to(name,'UTF8'),'hex') FROM users WHERE login='bootstrap_admin'") -Sensitive
    $expected = ([BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($env:SOLVIA_ADMIN_NAME))).Replace('-','').ToLowerInvariant()
    if ($actual -cne $expected) { throw 'Ukrainian administrator name was corrupted' }
    Write-Host 'Windows PostgreSQL bootstrap, Unicode and retry checks passed.'
} finally {
    foreach ($key in @('SOLVIA_DATABASE_URL','SOLVIA_ADMIN_LOGIN','SOLVIA_ADMIN_NAME','SOLVIA_ADMIN_PASSWORD','PGPASSWORD','PGCLIENTENCODING')) { [Environment]::SetEnvironmentVariable($key,$null,'Process') }
    if ($started) { Invoke-SetupProcess $pg.FullName @('-D',$data,'-m','immediate','-w','stop') -Sensitive | Out-Null }
    Remove-Item $root -Recurse -Force
}
