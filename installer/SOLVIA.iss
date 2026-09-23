#define MyAppName "SOLVIA by QureMed"
#define MyAppVersion "2.0.0"
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
SetupIconFile=..\assets\solvia.ico

[Files]
Source: "..\out\SOLVIA\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\SOLVIA"; Filename: "{app}\Solvia.exe"
Name: "{autodesktop}\SOLVIA"; Filename: "{app}\Solvia.exe"

Name: "{autoprograms}\Налаштувати SOLVIA"; Filename: "{app}\installer\Configure-SOLVIA.cmd"

[Run]
Filename: "{app}\Solvia.exe"; Description: "Запустити SOLVIA"; Flags: nowait postinstall skipifsilent; Check: IsServerConfigured

[UninstallRun]
Filename: "schtasks.exe"; Parameters: "/Delete /TN ""SOLVIA Local Server"" /F"; Flags: runhidden


[Code]
var
  AccountPage: TInputQueryWizardPage;
  Configured: Boolean;

function ExistingSetup: Boolean;
var Text: AnsiString;
begin
  Result := False;
  if LoadStringFromFile(ExpandConstant('{commonappdata}\QureMed\SOLVIA\server.env'), Text) then
    Result := (Pos('SOLVIA_DATABASE_URL=', String(Text)) > 0) and
      (Pos('SOLVIA_SETUP_PENDING=1', String(Text)) = 0);
end;

function ExistingPostgreSQL: Boolean;
begin
  Result :=
    FileExists(ExpandConstant('{pf}\PostgreSQL\17\bin\psql.exe')) or
    FileExists(ExpandConstant('{pf32}\PostgreSQL\17\bin\psql.exe'));
end;

procedure InitializeWizard;
begin
  Configured := False;
  AccountPage := CreateInputQueryPage(wpSelectDir, 'SOLVIA 2.0 — налаштування центру',
    'Обліковий запис адміністратора',
    'Для першого встановлення створіть адміністратора. При оновленні наявні облікові записи зберігаються. Пароль postgres потрібен лише для підключення до вже встановленого PostgreSQL без конфігурації SOLVIA.');
  AccountPage.Add('Логін адміністратора (латиниця, цифри, . _ -):', False);
  AccountPage.Add('Пароль SOLVIA (12–128 символів):', True);
  AccountPage.Add('Повторіть пароль SOLVIA:', True);
  AccountPage.Add('Пароль наявного PostgreSQL (користувач postgres):', True);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = AccountPage.ID) and not ExistingSetup then begin
    Result := (Length(AccountPage.Values[0]) >= 3) and
      (Length(AccountPage.Values[1]) >= 12) and (Length(AccountPage.Values[1]) <= 128) and
      (AccountPage.Values[1] = AccountPage.Values[2]);
    if not Result then begin
      MsgBox('Вкажіть логін, пароль від 12 до 128 символів та однакове підтвердження пароля.', mbError, MB_OK);
      Exit;
    end;
    if ExistingPostgreSQL and (Length(AccountPage.Values[3]) = 0) then begin
      MsgBox('На цьому ПК уже встановлено PostgreSQL 17. Введіть пароль користувача postgres у останньому полі. Це пароль PostgreSQL, а не пароль адміністратора SOLVIA.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
  InputDir, InputPath, Params, LogPath: String;
  Values: TArrayOfString;
  Progress: TOutputMarqueeProgressWizardPage;
  Retry: Boolean;
begin
  if CurStep = ssInstall then begin
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN ""SOLVIA Local Server""', '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM SolviaServer.exe', '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
    Sleep(900);
    Exit;
  end;
  if CurStep <> ssPostInstall then Exit;
  InputDir := ExpandConstant('{tmp}\solvia-private');
  InputPath := InputDir + '\setup-input.txt';
  LogPath := ExpandConstant('{commonappdata}\QureMed\SOLVIA\install.log');
  Progress := CreateOutputMarqueeProgressPage('Налаштування SOLVIA 2.0', 'Встановлення PostgreSQL та запуск сервера можуть тривати кілька хвилин.');
  repeat
    Retry := False;
    Progress.Show;
    Progress.Animate;
    try
      if not ForceDirectories(InputDir) then RaiseException('Cannot create private setup directory');
      if not Exec(ExpandConstant('{sys}\icacls.exe'), '"' + InputDir + '" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)"', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
        RaiseException('Cannot protect setup credentials');
      if ExitCode <> 0 then RaiseException('Cannot protect setup credentials');
      SetArrayLength(Values, 3);
      Values[0] := AccountPage.Values[0];
      Values[1] := AccountPage.Values[1];
      Values[2] := AccountPage.Values[3];
      if not SaveStringsToUTF8File(InputPath, Values, False) then RaiseException('Cannot write setup input');
      Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\Invoke-Setup.ps1') + '" -InstallDir "' + ExpandConstant('{app}') + '" -InputFile "' + InputPath + '" -NonInteractive';
      Configured := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode);
      Configured := Configured and (ExitCode = 0);
    finally
      DeleteFile(InputPath);
      RemoveDir(InputDir);
      SetArrayLength(Values, 0);
      Progress.Hide;
    end;
    if not Configured and not WizardSilent then
      Retry := MsgBox('Налаштування не завершено. SOLVIA не буде запущено.' + #13#10 + 'Журнал: ' + LogPath + #13#10 + 'Повторити спробу? Пізніше можна запустити «Налаштувати SOLVIA» від імені адміністратора.', mbError, MB_RETRYCANCEL) = IDRETRY;
  until not Retry;
  AccountPage.Values[1] := '';
  AccountPage.Values[2] := '';
  AccountPage.Values[3] := '';
  if not Configured then begin
    WizardForm.FinishedHeadingLabel.Caption := 'SOLVIA потребує налаштування';
    WizardForm.FinishedLabel.Caption := 'Файли встановлено, але сервер не налаштовано. Журнал: ' + LogPath;
  end;
end;

function IsServerConfigured: Boolean;
begin
  Result := Configured;
end;

function GetCustomSetupExitCode: Integer;
begin
  if Configured then Result := 0 else Result := 1;
end;
