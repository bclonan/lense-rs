; Inno Setup 6.7.3 or newer. Build with scripts/build-bridge-installer.ps1.
#ifndef BridgeVersion
  #error BridgeVersion must come from bridge/Cargo.toml.
#endif
#ifndef BridgePayload
  #error BridgePayload must point to the inspected bridge executable.
#endif
#ifndef BridgeOutputDir
  #error BridgeOutputDir must be an artifact directory.
#endif

[Setup]
AppId={{D5F439D0-45D9-48A4-89D0-250A7B974ED1}
AppName=LenseBridge
AppVersion={#BridgeVersion}
AppVerName=LenseBridge {#BridgeVersion}
AppSupportURL=https://lense-visual-control.netlify.app/
DefaultDirName={localappdata}\Programs\LenseBridge
DefaultGroupName=LenseBridge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
CloseApplications=no
RestartApplications=no
Uninstallable=yes
UninstallDisplayName=LenseBridge
UninstallDisplayIcon={app}\LenseBridge-windows-x64.exe
OutputDir={#BridgeOutputDir}
OutputBaseFilename=LenseBridge-Setup-{#BridgeVersion}-x64
VersionInfoVersion={#BridgeVersion}
VersionInfoProductVersion={#BridgeVersion}
VersionInfoProductName=LenseBridge
VersionInfoDescription=LenseBridge per-user Windows setup
InfoAfterFile=START-HERE.txt
#ifdef PublicRelease
SignTool=LenseBridgePublisher
SignedUninstaller=yes
SignedUninstallerDir={#BridgeOutputDir}\signed-uninstallers
#else
SignedUninstaller=no
#endif

[Files]
Source: "{#BridgePayload}"; DestDir: "{app}"; DestName: "LenseBridge-windows-x64.exe"
Source: "START-HERE.txt"; DestDir: "{app}"

[Icons]
Name: "{group}\LenseBridge"; Filename: "{app}\LenseBridge-windows-x64.exe"; WorkingDir: "{app}"
Name: "{group}\Lense control center"; Filename: "https://lense-visual-control.netlify.app/"
Name: "{group}\LenseBridge instructions"; Filename: "{app}\START-HERE.txt"
Name: "{group}\Uninstall LenseBridge"; Filename: "{uninstallexe}"

; There is deliberately no Run, UninstallRun, service, or startup entry.
