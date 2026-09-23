param([Parameter(Mandatory=$true)][string]$BuildDir)
$ErrorActionPreference = 'Stop'
$bin = (Resolve-Path $BuildDir).Path
$work = Join-Path $env:RUNNER_TEMP ('solvia-ui-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
New-Item -ItemType Directory -Force 'out/ui' | Out-Null
$db = Join-Path $work 'test.db'
$init = & "$bin/SolviaServer.exe" --db $db --demo
if ($LASTEXITCODE -ne 0) { throw 'UI test initialization failed' }
$passwords = @{}
foreach ($line in $init) { if ($line -match '^(admin|reception|psychologist|director): (.+)$') { $passwords[$Matches[1]] = $Matches[2] } }
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Native {
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendTextMessage(IntPtr h,uint msg,IntPtr wp,string text,uint flags,uint timeout,out IntPtr result);
 public static void SetWindowText(IntPtr h,string value) { IntPtr result; if(h==IntPtr.Zero || SendTextMessage(h,0x000C,IntPtr.Zero,value,2,5000,out result)==IntPtr.Zero) throw new Exception("Cannot set native input"); }
 public delegate bool EnumCallback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback f,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h,EnumCallback f,IntPtr l);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,System.Text.StringBuilder s,int count);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int count);
 public static string DialogText(uint pid) { var texts=new System.Collections.Generic.List<string>(); EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);var cls=new System.Text.StringBuilder(100);GetClassName(h,cls,100);if(p==pid && cls.ToString()=="#32770")EnumChildWindows(h,(c,z)=>{var cn=new System.Text.StringBuilder(100);GetClassName(c,cn,100);if(cn.ToString()=="Static"){var t=new System.Text.StringBuilder(2048);GetWindowText(c,t,2048);texts.Add(t.ToString());}return true;},IntPtr.Zero);return true;},IntPtr.Zero);return string.Join(" | ",texts); }
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
 public static IntPtr SendMessage(IntPtr h,uint msg,IntPtr wp,IntPtr lp) { IntPtr result; if(SendMessageTimeout(h,msg,wp,lp,2,12000,out result)==IntPtr.Zero) throw new Exception("Native action timed out"); return result; }
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT rect);
 public struct RECT { public int Left,Top,Right,Bottom; }
}
'@
$env:SOLVIA_API = 'http://127.0.0.1:18765'
$serverProcess = Start-Process "$bin/SolviaServer.exe" -ArgumentList @('--db', $db, '--port', '18765') -PassThru -WindowStyle Hidden
$client = $null
try {
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    try { $auth = Invoke-RestMethod "$env:SOLVIA_API/api/login" -Method Post -ContentType 'application/json' -Body (@{login='reception';password=$passwords.reception}|ConvertTo-Json); $ready=$true; break }
    catch { Start-Sleep -Milliseconds 300 }
  }
  if (!$ready) { throw 'UI test server not ready' }
  $headers = @{Authorization="Bearer $($auth.token)"}
  $patients = @()
  foreach ($name in @('Демо Олександр','Демо Марія','Демо Андрій')) {
    $p = Invoke-RestMethod "$env:SOLVIA_API/api/patients" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{name=$name;phone='+380000000000';dob='1990-01-01';category='Ветеран/ветеранка';psychologist_id=3}|ConvertTo-Json)))
    $patients += $p.id
  }
  $day = Get-Date -Format yyyy-MM-dd
  for ($i=0; $i -lt 3; $i++) {
    $hour=9+$i*2
    $body=@{patient_ids=@($patients[$i]);psychologist_id=3;room_id=1;kind='individual';start=('{0}T{1:00}:00' -f $day,$hour);end=('{0}T{1:00}:00' -f $day,($hour+1))}|ConvertTo-Json
    Invoke-RestMethod "$env:SOLVIA_API/api/appointments" -Method Post -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
  }
  foreach ($role in @('reception','psychologist','director','admin')) {
    $client=Start-Process "$bin/Solvia.exe" -PassThru
    $hwnd=[IntPtr]::Zero
    for ($i=0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 200; $client.Refresh(); if ($client.HasExited) { throw "Client crashed: $role" }; $hwnd=$client.MainWindowHandle; if ($hwnd -ne [IntPtr]::Zero) { break } }
    if ($hwnd -eq [IntPtr]::Zero) { throw 'No native window' }
    [Native]::SetWindowText([Native]::GetDlgItem($hwnd,12),$role) | Out-Null
    [Native]::SetWindowText([Native]::GetDlgItem($hwnd,13),$passwords[$role]) | Out-Null
    try { [Native]::SendMessage($hwnd,0x0111,[IntPtr]14,[IntPtr]::Zero) | Out-Null }
    catch { throw ("Native login failed: " + [Native]::DialogText($client.Id) + " / " + $_.Exception.Message) }
    Start-Sleep -Milliseconds 400
    if ([Native]::GetDlgItem($hwnd,50) -eq [IntPtr]::Zero) { throw "Login did not show native table: $role" }
    $rect=New-Object Native+RECT
    [Native]::GetWindowRect($hwnd,[ref]$rect) | Out-Null
    $bitmap=New-Object Drawing.Bitmap(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    $dc=$graphics.GetHdc()
    try { [Native]::PrintWindow($hwnd,$dc,2) | Out-Null } finally { $graphics.ReleaseHdc($dc) }
    $bitmap.Save((Join-Path (Resolve-Path 'out/ui').Path "$role.png"))
    $graphics.Dispose(); $bitmap.Dispose()
    [Native]::SendMessage($hwnd,0x0111,[IntPtr]90,[IntPtr]::Zero) | Out-Null
    if ([Native]::GetDlgItem($hwnd,12) -eq [IntPtr]::Zero) { throw "Logout failed: $role" }
    Stop-Process -Id $client.Id -Force
    $client=$null
    Write-Host "Native login/table/logout passed: $role"
  }
} finally {
  if ($client -and !$client.HasExited) { Stop-Process -Id $client.Id -Force }
  if (!$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
  Remove-Item $work -Recurse -Force
}
