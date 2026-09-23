param([Parameter(Mandatory=$true)][string]$BuildDir)

$ErrorActionPreference = 'Stop'
$bin = (Resolve-Path $BuildDir).Path
$work = Join-Path $env:RUNNER_TEMP ('solvia-react-ui-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
New-Item -ItemType Directory -Force 'out/ui' | Out-Null

if (!(Test-Path (Join-Path $bin 'ui/index.html'))) {
  throw 'React UI is not staged beside Solvia.exe'
}

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Native {
  public delegate bool EnumCallback(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumCallback cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int count);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
  public struct RECT { public int Left, Top, Right, Bottom; }

  public static bool HasWebView(IntPtr root) {
    bool found = false;
    EnumChildWindows(root, (h,l) => {
      var cls = new System.Text.StringBuilder(256);
      GetClassName(h, cls, cls.Capacity);
      if (cls.ToString().Contains("Chrome_WidgetWin")) found = true;
      return !found;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$db = Join-Path $work 'test.db'
$init = & "$bin/SolviaServer.exe" --db $db --demo
if ($LASTEXITCODE -ne 0) { throw 'UI test initialization failed' }

$passwords = @{}
foreach ($line in $init) {
  if ($line -match '^(admin|reception|psychologist|director): (.+)$') {
    $passwords[$Matches[1]] = $Matches[2]
  }
}

$env:SOLVIA_API = 'http://127.0.0.1:18765'
$server = Start-Process "$bin/SolviaServer.exe" -ArgumentList @('--db', $db, '--port', '18765') -PassThru -WindowStyle Hidden
$client = $null

try {
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    try {
      Invoke-RestMethod "$env:SOLVIA_API/api/login" -Method Post -ContentType 'application/json' -Body (@{
        login = 'reception'
        password = $passwords.reception
      } | ConvertTo-Json) | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (!$ready) { throw 'UI test server not ready' }

  $client = Start-Process "$bin/Solvia.exe" -PassThru
  $hwnd = [IntPtr]::Zero

  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 250
    $client.Refresh()
    if ($client.HasExited) { throw 'Desktop client crashed before opening the React shell' }
    $hwnd = $client.MainWindowHandle
    if ($hwnd -ne [IntPtr]::Zero -and [Native]::HasWebView($hwnd)) { break }
  }

  if ($hwnd -eq [IntPtr]::Zero) { throw 'No SOLVIA desktop window' }
  if (![Native]::HasWebView($hwnd)) { throw 'WebView2 child window was not created' }

  Start-Sleep -Seconds 2
  $rect = New-Object Native+RECT
  [Native]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $bitmap = New-Object Drawing.Bitmap($width, $height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $dc = $graphics.GetHdc()
  try {
    [Native]::PrintWindow($hwnd, $dc, 2) | Out-Null
  } finally {
    $graphics.ReleaseHdc($dc)
  }
  $bitmap.Save((Join-Path (Resolve-Path 'out/ui').Path 'react-shell.png'))
  $graphics.Dispose()
  $bitmap.Dispose()

  Write-Host 'WebView2 React shell opened successfully.'
} finally {
  if ($client -and !$client.HasExited) { Stop-Process -Id $client.Id -Force }
  if ($server -and !$server.HasExited) { Stop-Process -Id $server.Id -Force }
  Remove-Item $work -Recurse -Force
}
