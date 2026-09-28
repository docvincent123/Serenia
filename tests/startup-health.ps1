$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../installer/Setup.Common.ps1"
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$marker = Join-Path $env:TEMP ([guid]::NewGuid().ToString()+'.ready')
$job = Start-Job -ArgumentList $port,$marker -ScriptBlock {
    param($Port,$Marker)
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$Port)
    try {
        $listener.Start()
        [IO.File]::WriteAllText($Marker,'ready')
        foreach ($version in @('2.0.0','1.1.0')) {
            $client = $listener.AcceptTcpClient()
            try {
                $stream = $client.GetStream()
                $reader = New-Object IO.StreamReader($stream)
                do { $line = $reader.ReadLine() } while ($line)
                $body = '{"ok":true,"version":"' + $version + '"}'
                $bytes = [Text.Encoding]::UTF8.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: application/json`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n" + $body)
                $stream.Write($bytes,0,$bytes.Length)
            } finally { $client.Close() }
        }
    } finally { $listener.Stop() }
}
$oldProxy = [Net.WebRequest]::DefaultWebProxy
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path $marker)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Test listener startup timed out' }
        Start-Sleep -Milliseconds 100
    }
    # Deliberately broken system proxy must not intercept localhost readiness.
    [Net.WebRequest]::DefaultWebProxy = New-Object Net.WebProxy('http://127.0.0.1:1')
    if ((Get-SolviaHealth $port).version -ne '2.0.0') { throw 'Healthy API rejected' }
    $rejected = $false
    try { Get-SolviaHealth $port | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Old API version accepted' }
    Wait-Job $job -Timeout 10 | Out-Null
    if ($job.State -ne 'Completed') { throw 'Test server failed' }
    Receive-Job $job -ErrorAction Stop | Out-Null
    $rejected = $false
    try { Get-SolviaHealth $port | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Stopped API accepted' }
    if (Test-SolviaTcpPort '127.0.0.1' $port) { throw 'Closed HTTPS port accepted' }
    Write-Host 'Startup health checks passed: direct HTTP, proxy bypass, version and stopped server.'
} finally {
    [Net.WebRequest]::DefaultWebProxy = $oldProxy
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Item $marker -Force -ErrorAction SilentlyContinue
}
