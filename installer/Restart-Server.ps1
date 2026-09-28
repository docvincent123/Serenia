param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

try {
    Stop-ScheduledTask -TaskName 'SOLVIA Local Server' -ErrorAction SilentlyContinue
    Get-Process SolviaServer -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    Start-ScheduledTask -TaskName 'SOLVIA Local Server'
    Start-Sleep -Seconds 3

    $ok = $false
    for ($i=0; $i -lt 20; $i++) {
        try {
            $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 2
            if ($response.ok) { $ok = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $ok) { throw 'Сервер перезапущено, але API ще не відповідає. Перевірте журнал SOLVIA.' }

    [System.Windows.Forms.MessageBox]::Show(
        'SOLVIA Server успішно перезапущено.',
        'SOLVIA Server Console',
        'OK',
        'Information'
    ) | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        'SOLVIA Server Console',
        'OK',
        'Error'
    ) | Out-Null
    exit 1
}
