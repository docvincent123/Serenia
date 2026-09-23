#define MyAppName "SOLVIA by QureMed"
#define MyAppVersion "0.3.0"
#define MyAppPublisher "QureMed Industries"
#define MyAppExeName "Solvia.exe"

[Setup]
AppId={{8B75B3EA-33FB-4D1D-A04C-58F4269D31C7}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\QureMed\SOLVIA
DefaultGroupName=SOLVIA
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\out\installer
OutputBaseFilename=SOLVIA-Setup-{#MyAppVersion}-Windows-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "..\out\SOLVIA\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\SOLVIA"; Filename: "{app}\Solvia.exe"
Name: "{autodesktop}\SOLVIA"; Filename: "{app}\Solvia.exe"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\Setup-Server.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"; Description: "Налаштувати PostgreSQL та локальний сервер SOLVIA"; Flags: waituntilterminated
Filename: "{app}\Solvia.exe"; Description: "Запустити SOLVIA"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "schtasks.exe"; Parameters: "/Delete /TN ""SOLVIA Local Server"" /F"; Flags: runhidden
