# Shared helpers; compatible with Windows PowerShell 5.1.
function ConvertTo-ProcessArgument([string]$Value) {
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Invoke-SetupProcess {
    param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds = 900, [switch]$Sensitive)
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
        [IO.File]::Replace($temporary, $Path, $null)
    } else { [IO.File]::Move($temporary, $Path) }
}
function Protect-SetupPath([string]$Path, [switch]$Container) {
    $permissions = if ($Container) { '(OI)(CI)(F)' } else { '(F)' }
    Invoke-SetupProcess -FilePath "$env:SystemRoot\System32\icacls.exe" -Arguments @(
        $Path, '/inheritance:r', '/grant:r', ('*S-1-5-18:' + $permissions), ('*S-1-5-32-544:' + $permissions)
    ) | Out-Null
}
