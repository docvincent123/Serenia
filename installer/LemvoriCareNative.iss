[Setup]
AppId={{B1E6976A-106F-46F6-B1F6-16824606B229}
AppName=Lemvori Care
AppVersion=3.13.0
AppPublisher=LemvoriLab
DefaultDirName={autopf}\LemvoriLab\Lemvori Care
DefaultGroupName=Lemvori Care
PrivilegesRequired=admin
OutputDir=..\out\native-installer
OutputBaseFilename=Lemvori-Care-3.13.0-build-182046-Windows-Setup
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
UninstallDisplayIcon={app}\Lemvori Care.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "workplace"; Description: "Lemvori Care"
Name: "administration"; Description: "Lemvori Care + Lemvori Care Admin"
Name: "custom"; Description: "Вибір компонентів"; Flags: iscustom

[Components]
Name: "staff"; Description: "Lemvori Care"; Types: workplace administration custom; Flags: fixed
Name: "admin"; Description: "Lemvori Care Admin"; Types: administration

[Files]
Source: "..\out\lemvori-care-native\*"; Excludes: "Lemvori Care Admin.exe"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: staff
Source: "..\out\lemvori-care-native\Lemvori Care Admin.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: admin
Source: "..\out\native-prerequisites\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\Lemvori Care"; Filename: "{app}\Lemvori Care.exe"; Components: staff
Name: "{group}\Lemvori Care Admin"; Filename: "{app}\Lemvori Care Admin.exe"; Components: admin

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;
  if not Exec(ExpandConstant('{tmp}\vc_redist.x64.exe'), '/install /quiet /norestart', '',
      SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Microsoft Visual C++ runtime could not be started.');
  if (ResultCode <> 0) and (ResultCode <> 1638) and (ResultCode <> 3010) then
    RaiseException(Format('Microsoft Visual C++ runtime setup failed (%d).', [ResultCode]));
end;
