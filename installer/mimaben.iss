; 密码本 安装程序（Inno Setup 6）。由 .github/workflows/release.yml 在 Windows 上打包：
;   build\py\     自带的 Python（NuGet 上的官方包）+ pywebview
;   /DAppVersion=1.2.3 由发布的版本号传进来
; 装到当前用户自己的目录，不用管理员权限；卸载时「私密原件」文件夹（账号密码）不删。

#define AppName "密码本"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6B0C2B5E-3A51-4E0B-9D0B-7C2A8F1E4D27}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=mimaben-setup-{#AppVersion}
SetupIconFile=..\tools\app_icon.ico
UninstallDisplayIcon={app}\tools\app_icon.ico
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 更新时装到原来的位置，旧版本在运行就先请它关掉
CloseApplications=yes

[Languages]
Name: "chs"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "..\tools\*"; DestDir: "{app}\tools"; Excludes: "__pycache__,*.pyc"; Flags: recursesubdirs ignoreversion
Source: "..\模板.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\py\*"; DestDir: "{app}\python"; Excludes: "__pycache__,*.pyc"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\python\pythonw.exe"; Parameters: "-X utf8 ""{app}\tools\app.py"""; WorkingDir: "{app}"; IconFilename: "{app}\tools\app_icon.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\python\pythonw.exe"; Parameters: "-X utf8 ""{app}\tools\app.py"""; WorkingDir: "{app}"; IconFilename: "{app}\tools\app_icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\python\pythonw.exe"; Parameters: "-X utf8 ""{app}\tools\app.py"""; WorkingDir: "{app}"; Description: "打开{#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 只删程序自己运行时生成的缓存；「私密原件」不在这里，卸载后还留着
Type: filesandordirs; Name: "{app}\tools\__pycache__"
Type: filesandordirs; Name: "{app}\python"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant('{app}\私密原件');
    if DirExists(Data) then
      MsgBox('程序已卸载。你的账号密码记录没有删，还在：' + #13#10 + Data + #13#10#13#10 +
             '重新安装到同一个位置就能接着用；确定不要了，再自己删掉这个文件夹。', mbInformation, MB_OK);
  end;
end;
