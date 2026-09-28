# Import only the CA explicitly selected and confirmed by this Windows user.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Оберіть QureMed-Local-CA.crt із вашого Linux-сервера'
    $picker.Filter = 'Сертифікат CA (*.crt;*.cer)|*.crt;*.cer'
    if ($picker.ShowDialog() -ne 'OK') { exit 0 }
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($picker.FileName)
    $ca = $false
    foreach ($extension in $cert.Extensions) {
        if ($extension.Oid.Value -eq '2.5.29.19') {
            $basic = New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($extension, $extension.Critical)
            $ca = $basic.CertificateAuthority
        }
    }
    if (!$ca -or $cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)) { throw 'Оберіть чинний CA-сертифікат сервера SOLVIA.' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $fingerprint = [BitConverter]::ToString($sha.ComputeHash($cert.RawData)).Replace('-', ':') } finally { $sha.Dispose() }
    $message = "Додати довіру до сертифіката для цього Windows-користувача?`n`n$($cert.Subject)`nSHA-256: $fingerprint`n`nЗвірте відбиток з інсталятором Linux-сервера центру. Довіряйте лише сертифікату свого адміністратора."
    if ([System.Windows.Forms.MessageBox]::Show($message, 'SOLVIA — довіра до сервера', 'YesNo', 'Warning') -ne 'Yes') { exit 0 }
    Import-Certificate -FilePath $picker.FileName -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    [System.Windows.Forms.MessageBox]::Show('Сертифікат додано. Перезапустіть SOLVIA та перевірте підключення.', 'SOLVIA') | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'SOLVIA', 'OK', 'Error') | Out-Null
    exit 1
}
